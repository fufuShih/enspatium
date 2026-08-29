use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::user::User;

#[derive(Debug)]
pub enum UserServiceError {
    InvalidInput(&'static str),
    InvalidCredentials,
    Conflict,
    NotFound,
    PasswordHash,
    Database(sqlx::Error),
}

pub async fn create_user(
    database: &PgPool,
    username: String,
    email: String,
    password: String,
) -> Result<User, UserServiceError> {
    let username = username.trim().to_owned();
    let email = email.trim().to_ascii_lowercase();

    validate_create_user(&username, &email, &password)?;

    let password_hash = tokio::task::spawn_blocking(move || {
        hash_password(&password).map_err(|_| UserServiceError::PasswordHash)
    })
    .await
    .map_err(|_| UserServiceError::PasswordHash)??;

    let user = User::new(username, email);

    sqlx::query(
        r#"
        INSERT INTO users (id, username, email, password_hash)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(user.id)
    .bind(&user.username)
    .bind(&user.email)
    .bind(password_hash)
    .execute(database)
    .await
    .map_err(map_database_error)?;

    Ok(user)
}

pub async fn get_user(database: &PgPool, id: Uuid) -> Result<User, UserServiceError> {
    let row = sqlx::query_as::<_, (Uuid, String, String)>(
        "SELECT id, username, email FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(database)
    .await
    .map_err(UserServiceError::Database)?;

    row.map(|(id, username, email)| User {
        id,
        username,
        email,
    })
    .ok_or(UserServiceError::NotFound)
}

pub async fn authenticate_user(
    database: &PgPool,
    email: String,
    password: String,
) -> Result<User, UserServiceError> {
    let email = email.trim().to_ascii_lowercase();

    if email.is_empty() || password.is_empty() {
        return Err(UserServiceError::InvalidCredentials);
    }

    let row = sqlx::query_as::<_, (Uuid, String, String, String)>(
        r#"
        SELECT id, username, email, password_hash
        FROM users
        WHERE email = $1
        "#,
    )
    .bind(&email)
    .fetch_optional(database)
    .await
    .map_err(UserServiceError::Database)?
    .ok_or(UserServiceError::InvalidCredentials)?;

    let (id, username, email, password_hash) = row;

    let password_matches =
        tokio::task::spawn_blocking(move || verify_password(&password, &password_hash))
            .await
            .map_err(|_| UserServiceError::PasswordHash)?
            .map_err(|_| UserServiceError::PasswordHash)?;

    if !password_matches {
        return Err(UserServiceError::InvalidCredentials);
    }

    Ok(User {
        id,
        username,
        email,
    })
}

fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);

    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
}

fn verify_password(
    password: &str,
    password_hash: &str,
) -> Result<bool, argon2::password_hash::Error> {
    let parsed_hash = PasswordHash::new(password_hash)?;

    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

fn validate_create_user(
    username: &str,
    email: &str,
    password: &str,
) -> Result<(), UserServiceError> {
    if username.is_empty() {
        return Err(UserServiceError::InvalidInput("username is required"));
    }

    if email.is_empty() || !email.contains('@') {
        return Err(UserServiceError::InvalidInput("a valid email is required"));
    }

    if password.len() < 8 {
        return Err(UserServiceError::InvalidInput(
            "password must contain at least 8 characters",
        ));
    }

    Ok(())
}

fn map_database_error(error: sqlx::Error) -> UserServiceError {
    if error
        .as_database_error()
        .is_some_and(|error| error.is_unique_violation())
    {
        UserServiceError::Conflict
    } else {
        UserServiceError::Database(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_and_verifies_password() {
        let password_hash = hash_password("correct-password").expect("password hashing failed");

        assert!(password_hash.starts_with("$argon2id$"));
        assert!(
            verify_password("correct-password", &password_hash)
                .expect("password verification failed")
        );
        assert!(
            !verify_password("wrong-password", &password_hash)
                .expect("password verification failed")
        );
    }

    #[test]
    fn rejects_invalid_password_hash() {
        assert!(verify_password("password", "invalid-hash").is_err());
    }

    #[test]
    fn validates_create_user_input() {
        assert!(validate_create_user("felix", "felix@example.com", "password123").is_ok());
        assert!(validate_create_user("", "felix@example.com", "password123").is_err());
        assert!(validate_create_user("felix", "invalid", "password123").is_err());
        assert!(validate_create_user("felix", "felix@example.com", "short").is_err());
    }
}

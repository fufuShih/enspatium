use argon2::{
    Argon2,
    password_hash::{PasswordHasher, SaltString, rand_core::OsRng},
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::user::User;

#[derive(Debug)]
pub enum UserServiceError {
    InvalidInput(&'static str),
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

fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);

    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
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
    use argon2::password_hash::{PasswordHash, PasswordVerifier};

    use super::*;

    #[test]
    fn hashes_and_verifies_password() {
        let password_hash = hash_password("correct-password").expect("password hashing failed");
        let parsed_hash = PasswordHash::new(&password_hash).expect("password hash parsing failed");

        assert!(password_hash.starts_with("$argon2id$"));
        assert!(
            Argon2::default()
                .verify_password("correct-password".as_bytes(), &parsed_hash)
                .is_ok()
        );
        assert!(
            Argon2::default()
                .verify_password("wrong-password".as_bytes(), &parsed_hash)
                .is_err()
        );
    }

    #[test]
    fn validates_create_user_input() {
        assert!(validate_create_user("felix", "felix@example.com", "password123").is_ok());
        assert!(validate_create_user("", "felix@example.com", "password123").is_err());
        assert!(validate_create_user("felix", "invalid", "password123").is_err());
        assert!(validate_create_user("felix", "felix@example.com", "short").is_err());
    }
}

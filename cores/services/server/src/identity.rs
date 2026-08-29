use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub email: String,
}

impl User {
    pub fn new(username: String, email: String) -> Self {
        Self {
            id: Uuid::new_v4(),
            username,
            email,
        }
    }
}

pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);

    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
}

pub fn verify_password(password: &str, password_hash: &str) -> bool {
    let Ok(parsed_hash) = PasswordHash::new(password_hash) else {
        return false;
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

pub async fn create_user(
    database: &PgPool,
    username: String,
    email: String,
    password_hash: String,
) -> Result<User, sqlx::Error> {
    let user = User::new(username, email);

    sqlx::query(
        r#"
        INSERT INTO users (
            id,
            username,
            email,
            password_hash
        )
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(user.id)
    .bind(&user.username)
    .bind(&user.email)
    .bind(password_hash)
    .execute(database)
    .await?;

    Ok(user)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_user() {
        let user = User::new("felix".to_owned(), "felix@example.com".to_owned());

        assert_ne!(user.id, Uuid::nil());
        assert_eq!(user.username, "felix");
        assert_eq!(user.email, "felix@example.com");
    }

    #[test]
    fn hashes_and_verifies_password() {
        let password_hash = hash_password("correct-password").expect("password hashing failed");

        assert!(password_hash.starts_with("$argon2id$"));
        assert!(verify_password("correct-password", &password_hash));
        assert!(!verify_password("wrong-password", &password_hash));
    }
}

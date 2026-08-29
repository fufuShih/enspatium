use sqlx::PgPool;
use uuid::Uuid;

use crate::models::namespace::{Namespace, NamespaceKind};


#[derive(Debug)]
pub enum NamespaceServiceError {
    InvalidInput(&'static str),
    Conflict,
    Database(sqlx::Error),
}

pub async fn create_namespace(
    database: &PgPool,
    owner_user_id: Uuid,
    name: String,
    slug: String,
    kind: NamespaceKind,
) -> Result<Namespace, NamespaceServiceError> {
    let name = name.trim().to_owned();
    let slug = normalize_slug(&slug);

    validate_namespace(&name, &slug)?;

     let namespace = sqlx::query_as::<_, Namespace>(
        r#"
        INSERT INTO namespaces (
            id,
            owner_user_id,
            name,
            slug,
            kind
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
            id,
            owner_user_id,
            name,
            slug,
            kind
        "#,
     )
    .bind(Uuid::new_v4())
    .bind(owner_user_id)
    .bind(name)
    .bind(slug)
    .bind(kind)
    .fetch_one(database)
    .await
    .map_err(map_database_error)?;

    Ok(namespace)
}

pub async fn list_namespaces(
    database: &PgPool,
    owner_user_id: Uuid,
) -> Result<Vec<Namespace>, NamespaceServiceError> {
    sqlx::query_as::<_, Namespace>(
        r#"
        SELECT
            id,
            owner_user_id,
            name,
            slug,
            kind
        FROM namespaces
        WHERE owner_user_id = $1
        ORDER BY created_at ASC
        "#,
    )
    .bind(owner_user_id)
    .fetch_all(database)
    .await
    .map_err(NamespaceServiceError::Database)
}

fn normalize_slug(slug: &str) -> String {
    slug.trim().to_ascii_lowercase()
}

fn validate_namespace(
    name: &str,
    slug: &str,
) -> Result<(), NamespaceServiceError> {
    if name.is_empty() {
        return Err(NamespaceServiceError::InvalidInput(
            "namespace name is required",
        ));
    }

    if !(3..=40).contains(&slug.len()) {
        return Err(NamespaceServiceError::InvalidInput(
            "namespace slug must contain between 3 and 40 characters",
        ));
    }

    let contains_only_valid_characters = slug
        .bytes()
        .all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == b'-'
        });

    if !contains_only_valid_characters
        || slug.starts_with('-')
        || slug.ends_with('-')
        || slug.contains("--")
    {
        return Err(NamespaceServiceError::InvalidInput(
            "namespace slug may only contain lowercase letters, numbers, and single hyphens",
        ));
    }

    Ok(())
}

fn map_database_error(error: sqlx::Error) -> NamespaceServiceError {
    if error
        .as_database_error()
        .is_some_and(|error| error.is_unique_violation())
    {
        NamespaceServiceError::Conflict
    } else {
        NamespaceServiceError::Database(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_namespace_slug() {
        assert_eq!(normalize_slug(" Felix-Team "), "felix-team");
    }

    #[test]
    fn accepts_valid_namespace_input() {
        assert!(validate_namespace("Felix", "felix").is_ok());
        assert!(validate_namespace("Game Team", "game-team").is_ok());
        assert!(validate_namespace("Team 2", "team2").is_ok());
    }

    #[test]
    fn rejects_empty_namespace_name() {
        assert!(validate_namespace("", "felix").is_err());
    }

    #[test]
    fn rejects_invalid_namespace_slug() {
        assert!(validate_namespace("Felix", "ab").is_err());
        assert!(validate_namespace("Felix", "-felix").is_err());
        assert!(validate_namespace("Felix", "felix-").is_err());
        assert!(validate_namespace("Felix", "felix--team").is_err());
        assert!(validate_namespace("Felix", "felix_team").is_err());
        assert!(validate_namespace("Felix", "Felix").is_err());
    }
}
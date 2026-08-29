use serde::Serialize;
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
}

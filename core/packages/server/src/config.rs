use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub address: String,
    pub database_url: String,
    pub session_secure: bool,
}

impl Config {
    pub fn from_env() -> Self {
        let address = env::var("APP_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".to_owned());

        let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
        let session_secure = env::var("SESSION_SECURE")
            .map(|value| value.eq_ignore_ascii_case("true") || value == "1")
            .unwrap_or(false);

        Self {
            address,
            database_url,
            session_secure,
        }
    }
}

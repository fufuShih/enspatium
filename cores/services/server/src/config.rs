use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub address: String,
    pub database_url: String,
}

impl Config {
    pub fn from_env() -> Self {
        let address = env::var("APP_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".to_owned());

        let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");

        Self {
            address,
            database_url,
        }
    }
}

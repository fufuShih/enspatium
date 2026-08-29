use sqlx::{PgPool, migrate::MigrateError, postgres::PgPoolOptions};

pub async fn connect(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
}

pub async fn migrate(database: &PgPool) -> Result<(), MigrateError> {
    sqlx::migrate!("./migrations").run(database).await
}

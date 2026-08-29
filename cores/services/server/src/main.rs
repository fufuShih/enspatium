use tracing_subscriber::EnvFilter;

mod config;
mod database;
mod http;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "enspatium_server=debug,tower_http=debug".into()),
        )
        .init();

    let config = config::Config::from_env();

    let database = database::connect(&config.database_url)
        .await
        .expect("failed to connect to PostgreSQL");

    tracing::info!(connections = database.size(), "connected to PostgreSQL");

    let app = http::router();

    let listener = tokio::net::TcpListener::bind(&config.address)
        .await
        .expect("failed to bind server");

    tracing::info!(address = %config.address, "server started");

    axum::serve(listener, app).await.expect("server failed");
}

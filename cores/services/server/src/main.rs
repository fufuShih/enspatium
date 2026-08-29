use std::env;

use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "enspatium_server=debug,tower_http=debug".into()),
        )
        .init();

    let address = env::var("APP_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".to_owned());

    let app = enspatium_http::router();

    let listener = tokio::net::TcpListener::bind(&address)
        .await
        .expect("failed to bind server");

    tracing::info!(%address, "server started");

    axum::serve(listener, app).await.expect("server failed");
}

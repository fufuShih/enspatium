use axum::{Router, routing::get};

#[tokio::main]
async fn main() {
    let app = Router::new().route("/health", get(health));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000")
        .await
        .expect("failed to bind server");

    println!("Server running at http://127.0.0.1:3000");

    axum::serve(listener, app).await.expect("server failed");
}

async fn health() -> &'static str {
    "ok"
}

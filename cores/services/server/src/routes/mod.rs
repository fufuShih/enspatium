mod users;

use axum::{Router, routing::get};
use sqlx::PgPool;
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub(super) struct AppState {
    pub database: PgPool,
}

pub fn router(database: PgPool) -> Router {
    Router::new()
        .route("/health", get(health))
        .merge(users::router())
        .with_state(AppState { database })
        .layer(TraceLayer::new_for_http())
}

async fn health() -> &'static str {
    "ok"
}

mod auth;
mod users;

use axum::{Router, routing::get};
use sqlx::PgPool;
use time::Duration;
use tower_http::trace::TraceLayer;
use tower_sessions::{Expiry, MemoryStore, SessionManagerLayer, cookie::SameSite};

#[derive(Clone)]
pub(super) struct AppState {
    pub database: PgPool,
}

pub fn router(database: PgPool, session_secure: bool) -> Router {
    let session_layer = SessionManagerLayer::new(MemoryStore::default())
        .with_name("enspatium_session")
        .with_http_only(true)
        .with_same_site(SameSite::Strict)
        .with_secure(session_secure)
        .with_expiry(Expiry::OnInactivity(Duration::days(7)))
        .with_always_save(true);

    Router::new()
        .route("/health", get(health))
        .merge(auth::router())
        .merge(users::router())
        .with_state(AppState { database })
        .layer(TraceLayer::new_for_http())
        .layer(session_layer)
}

async fn health() -> &'static str {
    "ok"
}

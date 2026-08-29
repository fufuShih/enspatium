use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use sqlx::PgPool;
use tower_http::trace::TraceLayer;

use crate::identity;

#[derive(Clone)]
struct AppState {
    database: PgPool,
}

#[derive(Deserialize)]
struct CreateUserRequest {
    username: String,
    email: String,
    password: String,
}

type ApiError = (StatusCode, &'static str);

pub fn router(database: PgPool) -> Router {
    let state = AppState { database };

    Router::new()
        .route("/health", get(health))
        .route("/users", post(create_user))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

async fn health() -> &'static str {
    "ok"
}

async fn create_user(
    State(state): State<AppState>,
    Json(request): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<identity::User>), ApiError> {
    let username = request.username.trim().to_owned();
    let email = request.email.trim().to_ascii_lowercase();
    let password = request.password;

    if username.is_empty() || email.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            "password must contain at least 8 characters",
        ));
    }

    let password_hash =
        tokio::task::spawn_blocking(move || identity::hash_password(&password).map_err(|_| ()))
            .await
            .map_err(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "password hashing task failed",
                )
            })?
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "failed to hash password"))?;

    let user = identity::create_user(&state.database, username, email, password_hash)
        .await
        .map_err(|error| {
            let is_conflict = error
                .as_database_error()
                .is_some_and(|error| error.is_unique_violation());

            if is_conflict {
                (StatusCode::CONFLICT, "username or email already exists")
            } else {
                tracing::error!(%error, "failed to create user");

                (StatusCode::INTERNAL_SERVER_ERROR, "failed to create user")
            }
        })?;

    Ok((StatusCode::CREATED, Json(user)))
}

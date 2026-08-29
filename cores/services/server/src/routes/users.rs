use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use uuid::Uuid;

use super::AppState;
use crate::{models::user::User, services::users as user_service};

#[derive(Deserialize)]
struct CreateUserRequest {
    username: String,
    email: String,
    password: String,
}

type ApiError = (StatusCode, &'static str);

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/users", post(create_user))
        .route("/users/{id}", get(get_user))
}

async fn create_user(
    State(state): State<AppState>,
    Json(request): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<User>), ApiError> {
    let user = user_service::create_user(
        &state.database,
        request.username,
        request.email,
        request.password,
    )
    .await
    .map_err(map_service_error)?;

    Ok((StatusCode::CREATED, Json(user)))
}

async fn get_user(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<User>, ApiError> {
    user_service::get_user(&state.database, id)
        .await
        .map(Json)
        .map_err(map_service_error)
}

fn map_service_error(error: user_service::UserServiceError) -> ApiError {
    match error {
        user_service::UserServiceError::InvalidInput(message) => (StatusCode::BAD_REQUEST, message),
        user_service::UserServiceError::Conflict => {
            (StatusCode::CONFLICT, "username or email already exists")
        }
        user_service::UserServiceError::NotFound => (StatusCode::NOT_FOUND, "user not found"),
        user_service::UserServiceError::PasswordHash => {
            tracing::error!("failed to hash password");
            (StatusCode::INTERNAL_SERVER_ERROR, "failed to create user")
        }
        user_service::UserServiceError::Database(error) => {
            tracing::error!(%error, "user database operation failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "user operation failed")
        }
    }
}

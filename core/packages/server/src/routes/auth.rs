use axum::{Json, Router, extract::State, http::StatusCode, routing::post};
use serde::Deserialize;

use super::AppState;
use crate::{models::user::User, services::users as user_service};

#[derive(Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
}

type ApiError = (StatusCode, &'static str);

pub(super) fn router() -> Router<AppState> {
    Router::new().route("/auth/login", post(login))
}

async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<User>, ApiError> {
    user_service::authenticate_user(&state.database, request.email, request.password)
        .await
        .map(Json)
        .map_err(map_service_error)
}

fn map_service_error(error: user_service::UserServiceError) -> ApiError {
    match error {
        user_service::UserServiceError::InvalidCredentials => {
            (StatusCode::UNAUTHORIZED, "invalid email or password")
        }
        user_service::UserServiceError::PasswordHash => {
            tracing::error!("failed to verify password");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to authenticate user",
            )
        }
        user_service::UserServiceError::Database(error) => {
            tracing::error!(%error, "login database operation failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to authenticate user",
            )
        }
        user_service::UserServiceError::InvalidInput(_)
        | user_service::UserServiceError::Conflict
        | user_service::UserServiceError::NotFound => {
            tracing::error!("unexpected user service error during login");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to authenticate user",
            )
        }
    }
}

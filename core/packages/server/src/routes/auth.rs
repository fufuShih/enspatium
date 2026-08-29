use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use tower_sessions::Session;

use super::{
    AppState,
    current_user::{CurrentUser, USER_ID_KEY},
};
use crate::{models::user::User, services::users as user_service};

#[derive(Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
}

type ApiError = (StatusCode, &'static str);

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(login))
        .route("/auth/me", get(me))
        .route("/auth/logout", post(logout))
}

async fn login(
    State(state): State<AppState>,
    session: Session,
    Json(request): Json<LoginRequest>,
) -> Result<Json<User>, ApiError> {
    let user = user_service::authenticate_user(&state.database, request.email, request.password)
        .await
        .map_err(map_service_error)?;

    session
        .insert(USER_ID_KEY, user.id)
        .await
        .map_err(map_session_error)?;
    session.cycle_id().await.map_err(map_session_error)?;

    Ok(Json(user))
}

async fn me(CurrentUser(user): CurrentUser) -> Json<User> {
    Json(user)
}

async fn logout(session: Session) -> Result<StatusCode, ApiError> {
    session.flush().await.map_err(map_session_error)?;

    Ok(StatusCode::NO_CONTENT)
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

fn map_session_error(error: tower_sessions::session::Error) -> ApiError {
    tracing::error!(%error, "session operation failed");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "session operation failed",
    )
}

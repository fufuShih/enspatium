use axum::{
    extract::FromRequestParts,
    http::{StatusCode, request::Parts},
};
use tower_sessions::Session;
use uuid::Uuid;

use super::AppState;
use crate::{models::user::User, services::users as user_service};

pub(super) const USER_ID_KEY: &str = "user_id";

pub(super) struct CurrentUser(pub User);

type ApiError = (StatusCode, &'static str);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let session = Session::from_request_parts(parts, state).await?;
        let user_id = session
            .get::<Uuid>(USER_ID_KEY)
            .await
            .map_err(map_session_error)?
            .ok_or((StatusCode::UNAUTHORIZED, "authentication required"))?;

        match user_service::get_user(&state.database, user_id).await {
            Ok(user) => Ok(Self(user)),
            Err(user_service::UserServiceError::NotFound) => {
                session.flush().await.map_err(map_session_error)?;
                Err((StatusCode::UNAUTHORIZED, "authentication required"))
            }
            Err(user_service::UserServiceError::Database(error)) => {
                tracing::error!(%error, "current user database operation failed");
                Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to load current user",
                ))
            }
            Err(_) => {
                tracing::error!("unexpected user service error while loading current user");
                Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to load current user",
                ))
            }
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

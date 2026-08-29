use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    routing::get,
};
use serde::Deserialize;

use super::{
    AppState,
    current_user::CurrentUser,
};
use crate::{
    models::namespace::{Namespace, NamespaceKind},
    services::namespaces as namespace_service,
};

#[derive(Deserialize)]
struct CreateNamespaceRequest {
    name: String,
    slug: String,
    kind: NamespaceKind,
}

type ApiError = (StatusCode, &'static str);

pub(super) fn router() -> Router<AppState> {
    Router::new().route(
        "/namespaces",
        get(list_namespaces).post(create_namespace),
    )
}

async fn create_namespace(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Json(request): Json<CreateNamespaceRequest>,
) -> Result<(StatusCode, Json<Namespace>), ApiError> {
    let namespace = namespace_service::create_namespace(
        &state.database,
        user.id,
        request.name,
        request.slug,
        request.kind,
    )
    .await
    .map_err(map_service_error)?;

    Ok((StatusCode::CREATED, Json(namespace)))
}

async fn list_namespaces(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<Namespace>>, ApiError> {
    namespace_service::list_namespaces(
        &state.database,
        user.id,
    )
    .await
    .map(Json)
    .map_err(map_service_error)
}

fn map_service_error(
    error: namespace_service::NamespaceServiceError,
) -> ApiError {
    match error {
        namespace_service::NamespaceServiceError::InvalidInput(message) => {
            (StatusCode::BAD_REQUEST, message)
        }

        namespace_service::NamespaceServiceError::Conflict => {
            (
                StatusCode::CONFLICT,
                "namespace slug already exists or personal namespace already created",
            )
        }

        namespace_service::NamespaceServiceError::Database(error) => {
            tracing::error!(
                %error,
                "namespace database operation failed"
            );

            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "namespace operation failed",
            )
        }
    }
}
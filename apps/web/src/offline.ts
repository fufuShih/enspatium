// Deliberately independent of the authenticated application and its storage.
document.getElementById('retry')?.addEventListener('click', () => location.reload())
function connectionChanged() {
  const status = document.getElementById('connection')
  if (status) status.textContent = navigator.onLine ? 'A network connection is available. Try again to check the server.' : 'You are offline.'
}
window.addEventListener('online', connectionChanged)
window.addEventListener('offline', connectionChanged)
connectionChanged()

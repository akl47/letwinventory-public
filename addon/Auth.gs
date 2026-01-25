/**
 * Authentication module for Letwinventory Add-on
 */

/**
 * Get stored Letwinventory token
 * @returns {string|null} The stored token or null
 */
function getStoredToken() {
  return PropertiesService.getUserProperties().getProperty(TOKEN_KEY);
}

/**
 * Store Letwinventory token
 * @param {string} token - The JWT token to store
 */
function setStoredToken(token) {
  PropertiesService.getUserProperties().setProperty(TOKEN_KEY, token);
}

/**
 * Clear stored token (logout)
 */
function clearStoredToken() {
  PropertiesService.getUserProperties().deleteProperty(TOKEN_KEY);
}

/**
 * Authenticate with Letwinventory using Google ID token
 * @returns {string} The Letwinventory JWT token
 * @throws {Error} If authentication fails
 */
function authenticate() {
  const idToken = ScriptApp.getIdentityToken();

  if (!idToken) {
    throw new Error('Could not get Google identity token');
  }

  const response = UrlFetchApp.fetch(API_URL + '/auth/addon/token', {
    method: 'POST',
    contentType: 'application/json',
    headers: {
      'ngrok-skip-browser-warning': 'true'  // Skip ngrok's HTML warning page
    },
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (statusCode !== 200) {
    let errorMessage = 'Authentication failed';
    try {
      const errorData = JSON.parse(responseText);
      errorMessage = errorData.error || errorMessage;
    } catch (e) {
      // Use default error message
    }
    throw new Error(errorMessage);
  }

  const data = JSON.parse(responseText);
  setStoredToken(data.token);
  return data.token;
}

/**
 * Get valid token, authenticating if necessary
 * @returns {string} A valid JWT token
 */
function getValidToken() {
  let token = getStoredToken();

  if (!token) {
    token = authenticate();
  }

  return token;
}

/**
 * Check if user is authenticated
 * @returns {boolean} True if user has a stored token
 */
function isAuthenticated() {
  return !!getStoredToken();
}

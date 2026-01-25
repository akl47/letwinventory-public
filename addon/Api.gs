/**
 * API client for Letwinventory
 */

/**
 * Make an authenticated API request
 * @param {string} endpoint - API endpoint (e.g., '/planning/tasklist')
 * @param {Object} options - Fetch options
 * @returns {Object} Parsed JSON response
 */
function apiRequest(endpoint, options = {}) {
  const token = getValidToken();
  const fullUrl = API_URL + endpoint;

  console.log('=== API Request Debug ===');
  console.log('Endpoint:', endpoint);
  console.log('Full URL:', fullUrl);
  console.log('API_URL:', API_URL);
  console.log('Token (first 20 chars):', token ? token.substring(0, 20) + '...' : 'NO TOKEN');

  const defaultOptions = {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true'  // Skip ngrok's HTML warning page
    },
    muteHttpExceptions: true
  };

  const fetchOptions = Object.assign({}, defaultOptions, options);
  if (options.headers) {
    fetchOptions.headers = Object.assign({}, defaultOptions.headers, options.headers);
  }

  console.log('Method:', fetchOptions.method);
  if (fetchOptions.payload) {
    console.log('Payload:', fetchOptions.payload);
  }

  let response;
  try {
    response = UrlFetchApp.fetch(fullUrl, fetchOptions);
  } catch (fetchError) {
    console.error('UrlFetchApp.fetch failed:', fetchError.message);
    throw new Error('Network error: ' + fetchError.message);
  }

  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  console.log('Status Code:', statusCode);
  console.log('Response (first 500 chars):', responseText.substring(0, 500));

  // Handle token expiration/invalid - re-authenticate and retry
  if (statusCode === 401 || statusCode === 403) {
    console.log('Got ' + statusCode + ' - attempting re-authentication');
    clearStoredToken();
    const newToken = authenticate();
    fetchOptions.headers['Authorization'] = 'Bearer ' + newToken;

    const retryResponse = UrlFetchApp.fetch(fullUrl, fetchOptions);
    const retryStatus = retryResponse.getResponseCode();
    console.log('Retry Status Code:', retryStatus);

    if (retryStatus >= 400) {
      console.error('Retry failed with status:', retryStatus);
      throw new Error('API request failed after re-authentication (status: ' + retryStatus + ')');
    }
    return JSON.parse(retryResponse.getContentText());
  }

  if (statusCode >= 400) {
    let errorMessage = 'API request failed (status: ' + statusCode + ')';
    try {
      const errorData = JSON.parse(responseText);
      errorMessage = errorData.error || errorData.message || errorMessage;
      console.error('Error response:', JSON.stringify(errorData));
    } catch (e) {
      console.error('Non-JSON error response:', responseText.substring(0, 200));
    }
    throw new Error(errorMessage);
  }

  console.log('=== API Request Success ===');
  return JSON.parse(responseText);
}

/**
 * Fetch all task lists with their tasks
 * @returns {Array} Array of task list objects
 */
function fetchTaskLists() {
  return apiRequest('/planning/tasklist');
}

/**
 * Fetch tasks, optionally filtered by task list
 * @param {number} [taskListId] - Optional task list ID to filter by
 * @returns {Array} Array of task objects
 */
function fetchTasks(taskListId) {
  let endpoint = '/planning/task';
  if (taskListId) {
    endpoint += '?taskListId=' + taskListId;
  }
  return apiRequest(endpoint);
}

/**
 * Fetch a single task by ID
 * @param {number} taskId - The task ID
 * @returns {Object} Task object
 */
function fetchTask(taskId) {
  return apiRequest('/planning/task/' + taskId);
}

/**
 * Update a task
 * @param {number} taskId - The task ID
 * @param {Object} updates - Fields to update
 * @returns {Object} Updated task object
 */
function updateTask(taskId, updates) {
  return apiRequest('/planning/task/' + taskId, {
    method: 'PUT',
    payload: JSON.stringify(updates)
  });
}

/**
 * Toggle task completion status
 * @param {number} taskId - The task ID
 * @param {boolean} done - New completion status
 * @returns {Object} Updated task object
 */
function toggleTaskDone(taskId, done) {
  return updateTask(taskId, { doneFlag: done });
}

/**
 * Create a time tracking record linking a task to a calendar event
 * @param {number} taskId - The task ID
 * @param {string} calendarEventId - The Google Calendar event ID
 * @param {string} calendarId - The calendar ID (optional)
 * @returns {Object} Created time tracking record
 */
function createTimeTracking(taskId, calendarEventId, calendarId) {
  return apiRequest('/planning/task-time-tracking', {
    method: 'POST',
    payload: JSON.stringify({
      taskID: taskId,
      calendarEventID: calendarEventId,
      calendarID: calendarId
    })
  });
}

/**
 * Fetch all projects
 * @returns {Array} Array of project objects
 */
function fetchProjects() {
  return apiRequest('/planning/project');
}

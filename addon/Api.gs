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

  const response = UrlFetchApp.fetch(API_URL + endpoint, fetchOptions);
  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  // Handle token expiration - re-authenticate and retry
  if (statusCode === 401) {
    clearStoredToken();
    const newToken = authenticate();
    fetchOptions.headers['Authorization'] = 'Bearer ' + newToken;

    const retryResponse = UrlFetchApp.fetch(API_URL + endpoint, fetchOptions);
    if (retryResponse.getResponseCode() !== 200) {
      throw new Error('API request failed after re-authentication');
    }
    return JSON.parse(retryResponse.getContentText());
  }

  if (statusCode >= 400) {
    let errorMessage = 'API request failed';
    try {
      const errorData = JSON.parse(responseText);
      errorMessage = errorData.error || errorMessage;
    } catch (e) {
      // Use default error message
    }
    throw new Error(errorMessage);
  }

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

/**
 * Letwinventory Tasks - Google Workspace Add-on
 *
 * Entry points and action handlers
 */

/**
 * Homepage trigger - called when add-on is opened
 * @param {Object} e - Event object
 * @returns {Card} Homepage card
 */
function onHomepage(e) {
  if (!isAuthenticated()) {
    return buildLoginCard();
  }
  return buildTaskListCard();
}

/**
 * Calendar homepage trigger
 * @param {Object} e - Event object
 * @returns {Card} Calendar homepage card
 */
function onCalendarHomepage(e) {
  return onHomepage(e);
}

/**
 * Calendar event open trigger - called when viewing a calendar event
 * @param {Object} e - Event object with calendar event data
 * @returns {Card} Event context card
 */
function onEventOpen(e) {
  // For now, just show the task list
  // Future: Show tasks linked to this event
  return onHomepage(e);
}

/**
 * Connect action - authenticate with Letwinventory
 * @param {Object} e - Event object
 * @returns {ActionResponse} Navigation to task list
 */
function onConnect(e) {
  try {
    authenticate();
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation()
          .updateCard(buildTaskListCard())
      )
      .build();
  } catch (error) {
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation()
          .updateCard(buildErrorCard(error.message))
      )
      .build();
  }
}

/**
 * Refresh action - reload the task list
 * @param {Object} e - Event object
 * @returns {ActionResponse} Updated card
 */
function onRefresh(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .updateCard(buildTaskListCard())
    )
    .build();
}

/**
 * Task click action - show task details
 * @param {Object} e - Event object with taskId parameter
 * @returns {ActionResponse} Navigation to task detail card
 */
function onTaskClick(e) {
  const taskId = e.parameters.taskId;
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .pushCard(buildTaskDetailCard(taskId))
    )
    .build();
}

/**
 * Toggle task completion status
 * @param {Object} e - Event object with taskId and done parameters
 * @returns {ActionResponse} Updated card
 */
function onToggleTask(e) {
  try {
    const taskId = parseInt(e.parameters.taskId);
    const done = e.parameters.done === 'true';

    toggleTaskDone(taskId, done);

    // Refresh the task detail card
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation()
          .updateCard(buildTaskDetailCard(taskId))
      )
      .setNotification(
        CardService.newNotification()
          .setText(done ? 'Task marked complete' : 'Task marked incomplete')
      )
      .build();
  } catch (error) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('Error: ' + error.message)
      )
      .build();
  }
}

/**
 * Toggle task completion from list view (via switch control)
 * @param {Object} e - Event object with taskId parameter and form inputs
 * @returns {ActionResponse} Updated card with notification
 */
function onToggleTaskFromList(e) {
  try {
    const taskId = parseInt(e.parameters.taskId);
    const formInputs = e.commonEventObject.formInputs || {};
    const switchKey = 'taskDone_' + taskId;

    // Check if the switch is selected (task is being marked complete)
    const isNowComplete = formInputs[switchKey] && formInputs[switchKey].stringInputs.value.length > 0;

    toggleTaskDone(taskId, isNowComplete);

    // Refresh the task list card
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation()
          .updateCard(buildTaskListCard())
      )
      .setNotification(
        CardService.newNotification()
          .setText(isNowComplete ? '✓ Task complete' : 'Task reopened')
      )
      .build();
  } catch (error) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('Error: ' + error.message)
      )
      .build();
  }
}

/**
 * Back to list action
 * @param {Object} e - Event object
 * @returns {ActionResponse} Pop card navigation
 */
function onBackToList(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .popCard()
    )
    .build();
}

/**
 * Logout action - clear stored token
 * @param {Object} e - Event object
 * @returns {ActionResponse} Navigation to login card
 */
function onLogout(e) {
  clearStoredToken();
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .updateCard(buildLoginCard())
    )
    .setNotification(
      CardService.newNotification()
        .setText('Logged out')
    )
    .build();
}

/**
 * Task list change action - switch to a different task list
 * @param {Object} e - Event object with form inputs
 * @returns {ActionResponse} Updated card
 */
function onTaskListChange(e) {
  const formInputs = e.commonEventObject.formInputs || {};
  const selectedListId = formInputs.taskListId?.stringInputs?.value[0];

  if (selectedListId) {
    setSelectedTaskListId(selectedListId);
  }

  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .updateCard(buildTaskListCard())
    )
    .build();
}

/**
 * Add task to calendar action - creates a calendar event from a task
 * @param {Object} e - Event object with task parameters
 * @returns {ActionResponse} Notification of success/failure
 */
function onAddToCalendar(e) {
  try {
    var taskId = parseInt(e.parameters.taskId);
    var taskName = e.parameters.taskName;
    var taskDueDate = e.parameters.taskDueDate;
    var taskEstimate = parseInt(e.parameters.taskEstimate) || 60;
    var taskDescription = e.parameters.taskDescription || '';
    var taskProjectId = e.parameters.taskProjectId || '';

    // Calculate event times
    var startTime, endTime;
    var durationMs = taskEstimate * 60 * 1000; // Duration in milliseconds

    if (taskDueDate) {
      // End time is the due date, start time is calculated backwards
      endTime = new Date(taskDueDate);
      startTime = new Date(endTime.getTime() - durationMs);
    } else {
      // No due date - start now, rounded to nearest 15 minutes
      startTime = roundToNearest15Minutes(new Date());
      endTime = new Date(startTime.getTime() + durationMs);
    }

    // Get selected calendar or default
    var calendarId = getSelectedCalendarId();
    var calendar;
    if (calendarId) {
      calendar = CalendarApp.getCalendarById(calendarId);
    }
    if (!calendar) {
      calendar = CalendarApp.getDefaultCalendar();
      calendarId = calendar.getId();
    }

    // Create the calendar event
    var event = calendar.createEvent(taskName, startTime, endTime, {
      description: taskDescription
    });

    // Apply project color if set
    if (taskProjectId) {
      var projectColor = getProjectColor(taskProjectId);
      if (projectColor && projectColor !== '0') {
        event.setColor(projectColor);
      }
    }

    // Record the time tracking in the backend
    try {
      createTimeTracking(taskId, event.getId(), calendarId);
    } catch (trackingError) {
      // Log but don't fail - calendar event was still created
      console.error('Failed to record time tracking:', trackingError.message);
    }

    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('Event created: ' + formatEventTime(startTime))
      )
      .build();

  } catch (error) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification()
          .setText('Error creating event: ' + error.message)
      )
      .build();
  }
}

/**
 * Format event time for notification
 * @param {Date} date - Event start time
 * @returns {string} Formatted time string
 */
function formatEventTime(date) {
  const options = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return date.toLocaleDateString('en-US', options);
}

/**
 * Round a date down to the nearest 15-minute interval
 * @param {Date} date - Date to round
 * @returns {Date} Rounded date
 */
function roundToNearest15Minutes(date) {
  var result = new Date(date);
  var minutes = result.getMinutes();
  var roundedMinutes = Math.floor(minutes / 15) * 15;
  result.setMinutes(roundedMinutes, 0, 0);
  return result;
}

/**
 * Open settings action
 * @param {Object} e - Event object
 * @returns {ActionResponse} Navigation to settings card
 */
function onOpenSettings(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .pushCard(buildSettingsCard())
    )
    .build();
}

/**
 * Calendar setting change action
 * @param {Object} e - Event object with form inputs
 * @returns {ActionResponse} Notification of change
 */
function onCalendarSettingChange(e) {
  var formInputs = e.commonEventObject && e.commonEventObject.formInputs ? e.commonEventObject.formInputs : {};
  var calendarInput = formInputs.calendarId;
  var selectedCalendarId = calendarInput && calendarInput.stringInputs && calendarInput.stringInputs.value ? calendarInput.stringInputs.value[0] : null;

  if (selectedCalendarId) {
    setSelectedCalendarId(selectedCalendarId);
  }

  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification()
        .setText('Calendar updated')
    )
    .build();
}

/**
 * Project color setting change action
 * @param {Object} e - Event object with form inputs and projectId parameter
 * @returns {ActionResponse} Notification of change and card refresh
 */
function onProjectColorChange(e) {
  var projectId = e.parameters.projectId;
  var formInputs = e.commonEventObject && e.commonEventObject.formInputs ? e.commonEventObject.formInputs : {};
  var colorInput = formInputs['projectColor_' + projectId];
  var selectedColor = colorInput && colorInput.stringInputs && colorInput.stringInputs.value ? colorInput.stringInputs.value[0] : null;

  if (projectId && selectedColor !== null) {
    setProjectColor(projectId, selectedColor);
  }

  // Refresh the settings card to show updated color preview
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation()
        .updateCard(buildSettingsCard())
    )
    .setNotification(
      CardService.newNotification()
        .setText('Project color updated')
    )
    .build();
}

/**
 * UI Card builders for Letwinventory Add-on
 * Styled to match Google Tasks add-on
 */

/**
 * Build the login card shown when user is not authenticated
 * @returns {Card} Login card
 */
function buildLoginCard() {
  return CardService.newCardBuilder()
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newImage()
            .setImageUrl('https://www.gstatic.com/images/branding/product/2x/tasks_48dp.png')
        )
        .addWidget(
          CardService.newTextParagraph()
            .setText('<b>Letwinventory Tasks</b>')
        )
        .addWidget(
          CardService.newTextParagraph()
            .setText('Sign in to view and manage your tasks.')
        )
        .addWidget(
          CardService.newTextButton()
            .setText('Sign in')
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onConnect')
            )
        )
    )
    .build();
}

/**
 * Build the main task list card - Google Tasks style
 * @returns {Card} Task list card
 */
function buildTaskListCard() {
  try {
    const taskLists = fetchTaskLists();

    if (!taskLists || taskLists.length === 0) {
      return CardService.newCardBuilder()
        .addSection(
          CardService.newCardSection()
            .addWidget(
              CardService.newTextParagraph()
                .setText('No task lists found.')
            )
        )
        .build();
    }

    // Fetch projects for lookup
    var projectMap = {};
    try {
      var projects = fetchProjects();
      projects.forEach(function(p) {
        projectMap[p.id] = p;
      });
    } catch (e) {
      // Continue without project info if fetch fails
    }

    // Get selected task list ID from storage, default to first list
    const selectedListId = getSelectedTaskListId() || taskLists[0].id;
    const taskList = taskLists.find(function(l) { return l.id == selectedListId; }) || taskLists[0];
    const tasks = taskList.tasks || [];

    // Filter to active, non-done tasks only
    const pendingTasks = tasks
      .filter(function(t) { return t.activeFlag && !t.doneFlag; })
      .sort(function(a, b) { return (a.rank || 0) - (b.rank || 0); });

    const card = CardService.newCardBuilder();

    // Task list selector dropdown
    const selectorSection = CardService.newCardSection();
    const dropdown = CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('taskListId')
      .setTitle('Task List')
      .setOnChangeAction(
        CardService.newAction()
          .setFunctionName('onTaskListChange')
      );

    taskLists.forEach(function(list) {
      dropdown.addItem(list.name, String(list.id), list.id == selectedListId);
    });

    selectorSection.addWidget(dropdown);
    card.addSection(selectorSection);

    // Tasks section
    if (pendingTasks.length === 0) {
      card.addSection(
        CardService.newCardSection()
          .addWidget(
            CardService.newTextParagraph()
              .setText('No tasks. Enjoy your day!')
          )
      );
    } else {
      const section = CardService.newCardSection();

      pendingTasks.forEach(function(task) {
        var project = task.projectID ? projectMap[task.projectID] : null;
        section.addWidget(buildTaskWidgetWithCalendar(task, project));
      });

      card.addSection(section);
    }

    // Footer with refresh and settings
    card.setFixedFooter(
      CardService.newFixedFooter()
        .setPrimaryButton(
          CardService.newTextButton()
            .setText('Refresh')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onRefresh')
            )
        )
        .setSecondaryButton(
          CardService.newTextButton()
            .setText('Settings')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onOpenSettings')
            )
        )
    );

    return card.build();

  } catch (error) {
    return buildErrorCard(error.message);
  }
}

/**
 * Build a widget for a single task with calendar button - Google Tasks style
 * @param {Object} task - Task object
 * @param {Object} project - Project object (optional)
 * @returns {Widget} Decorated text widget for the task
 */
function buildTaskWidgetWithCalendar(task, project) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = task.dueDate && new Date(task.dueDate) < today;

  // Build subtitle parts
  const parts = [];
  if (project) {
    parts.push(project.name);
  }
  if (task.dueDate) {
    const dateStr = formatDateRelative(task.dueDate);
    parts.push(isOverdue ? '⚠ ' + dateStr : dateStr);
  }
  if (task.timeEstimate) {
    parts.push(formatDuration(task.timeEstimate));
  }

  const widget = CardService.newDecoratedText()
    .setText(task.name)
    .setWrapText(true)
    .setStartIcon(
      CardService.newIconImage()
        .setIconUrl('https://www.gstatic.com/images/icons/material/system/1x/radio_button_unchecked_grey600_24dp.png')
    )
    .setButton(
      CardService.newTextButton()
        .setText('+')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onAddToCalendar')
            .setParameters({
              taskId: String(task.id),
              taskName: task.name,
              taskDueDate: task.dueDate || '',
              taskEstimate: String(task.timeEstimate || 60),
              taskDescription: task.description || '',
              taskProjectId: String(task.projectID || '')
            })
        )
    )
    .setOnClickAction(
      CardService.newAction()
        .setFunctionName('onTaskClick')
        .setParameters({ taskId: String(task.id) })
    );

  if (parts.length > 0) {
    widget.setBottomLabel(parts.join(' · '));
  }

  return widget;
}

/**
 * Build a widget for a single task - Google Tasks style (no calendar button)
 * @param {Object} task - Task object
 * @returns {Widget} Decorated text widget for the task
 */
function buildTaskWidget(task) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = task.dueDate && new Date(task.dueDate) < today;

  // Build subtitle
  const parts = [];
  if (task.dueDate) {
    const dateStr = formatDateRelative(task.dueDate);
    parts.push(isOverdue ? '⚠ ' + dateStr : dateStr);
  }
  if (task.timeEstimate) {
    parts.push(formatDuration(task.timeEstimate));
  }

  const widget = CardService.newDecoratedText()
    .setText(task.name)
    .setWrapText(true)
    .setStartIcon(
      CardService.newIconImage()
        .setIconUrl('https://www.gstatic.com/images/icons/material/system/1x/radio_button_unchecked_grey600_24dp.png')
    )
    .setOnClickAction(
      CardService.newAction()
        .setFunctionName('onTaskClick')
        .setParameters({ taskId: String(task.id) })
    );

  if (parts.length > 0) {
    widget.setBottomLabel(parts.join(' · '));
  }

  return widget;
}

/**
 * Build the task detail card - Google Tasks style
 * @param {number} taskId - Task ID
 * @returns {Card} Task detail card
 */
function buildTaskDetailCard(taskId) {
  try {
    const task = fetchTask(taskId);

    const card = CardService.newCardBuilder()
      .setHeader(
        CardService.newCardHeader()
          .setTitle(task.name)
      );

    const section = CardService.newCardSection();

    // Status row - clickable to toggle
    section.addWidget(
      CardService.newDecoratedText()
        .setText(task.doneFlag ? 'Completed' : 'Not completed')
        .setStartIcon(
          CardService.newIconImage()
            .setIconUrl(task.doneFlag
              ? 'https://www.gstatic.com/images/icons/material/system/1x/check_circle_grey600_24dp.png'
              : 'https://www.gstatic.com/images/icons/material/system/1x/radio_button_unchecked_grey600_24dp.png')
        )
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onToggleTask')
            .setParameters({
              taskId: String(task.id),
              done: String(!task.doneFlag)
            })
        )
    );

    // Due date
    if (task.dueDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isOverdue = new Date(task.dueDate) < today && !task.doneFlag;

      section.addWidget(
        CardService.newDecoratedText()
          .setText(formatDateRelative(task.dueDate))
          .setTopLabel('Due')
          .setStartIcon(
            CardService.newIconImage()
              .setIcon(CardService.Icon.CLOCK)
          )
      );
    }

    // Time estimate
    if (task.timeEstimate) {
      section.addWidget(
        CardService.newDecoratedText()
          .setText(formatDuration(task.timeEstimate))
          .setTopLabel('Estimate')
          .setStartIcon(
            CardService.newIconImage()
              .setIcon(CardService.Icon.CLOCK)
          )
      );
    }

    // Add to Calendar button
    section.addWidget(
      CardService.newDecoratedText()
        .setText('Add to Calendar')
        .setStartIcon(
          CardService.newIconImage()
            .setIcon(CardService.Icon.EVENT_PERFORMER)
        )
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onAddToCalendar')
            .setParameters({
              taskId: String(task.id),
              taskName: task.name,
              taskDueDate: task.dueDate || '',
              taskEstimate: String(task.timeEstimate || 60),
              taskDescription: task.description || '',
              taskProjectId: String(task.projectID || '')
            })
        )
    );

    card.addSection(section);

    // Description
    if (task.description) {
      card.addSection(
        CardService.newCardSection()
          .setHeader('Notes')
          .addWidget(
            CardService.newTextParagraph()
              .setText(task.description)
          )
      );
    }

    // Footer
    card.setFixedFooter(
      CardService.newFixedFooter()
        .setPrimaryButton(
          CardService.newTextButton()
            .setText(task.doneFlag ? 'Mark incomplete' : 'Mark complete')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onToggleTask')
                .setParameters({
                  taskId: String(task.id),
                  done: String(!task.doneFlag)
                })
            )
        )
        .setSecondaryButton(
          CardService.newTextButton()
            .setText('Back')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onBackToList')
            )
        )
    );

    return card.build();

  } catch (error) {
    return buildErrorCard(error.message);
  }
}

/**
 * Build the settings card
 * @returns {Card} Settings card
 */
function buildSettingsCard() {
  try {
    const calendars = CalendarApp.getAllCalendars();
    const selectedCalendarId = getSelectedCalendarId() || CalendarApp.getDefaultCalendar().getId();

    const card = CardService.newCardBuilder()
      .setHeader(
        CardService.newCardHeader()
          .setTitle('Settings')
      );

    // Calendar section
    const calendarSection = CardService.newCardSection()
      .setHeader('Calendar');

    const calendarDropdown = CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName('calendarId')
      .setTitle('Add events to')
      .setOnChangeAction(
        CardService.newAction()
          .setFunctionName('onCalendarSettingChange')
      );

    calendars.forEach(function(cal) {
      calendarDropdown.addItem(cal.getName(), cal.getId(), cal.getId() === selectedCalendarId);
    });

    calendarSection.addWidget(calendarDropdown);
    card.addSection(calendarSection);

    // Project colors section
    try {
      const projects = fetchProjects();
      if (projects && projects.length > 0) {
        const colorSection = CardService.newCardSection()
          .setHeader('Project Event Colors');

        projects.forEach(function(project) {
          var savedColor = getProjectColor(project.id);
          var colorHex = getColorHex(savedColor || '0');

          var colorDropdown = CardService.newSelectionInput()
            .setType(CardService.SelectionInputType.DROPDOWN)
            .setFieldName('projectColor_' + project.id)
            .setTitle(project.name)
            .setOnChangeAction(
              CardService.newAction()
                .setFunctionName('onProjectColorChange')
                .setParameters({ projectId: String(project.id) })
            );

          // Add color options
          colorDropdown.addItem('Default', '0', savedColor === '0' || !savedColor);
          colorDropdown.addItem('Pale Blue', '1', savedColor === '1');
          colorDropdown.addItem('Pale Green', '2', savedColor === '2');
          colorDropdown.addItem('Mauve', '3', savedColor === '3');
          colorDropdown.addItem('Pale Red', '4', savedColor === '4');
          colorDropdown.addItem('Yellow', '5', savedColor === '5');
          colorDropdown.addItem('Orange', '6', savedColor === '6');
          colorDropdown.addItem('Cyan', '7', savedColor === '7');
          colorDropdown.addItem('Gray', '8', savedColor === '8');
          colorDropdown.addItem('Blue', '9', savedColor === '9');
          colorDropdown.addItem('Green', '10', savedColor === '10');
          colorDropdown.addItem('Red', '11', savedColor === '11');

          colorSection.addWidget(colorDropdown);

          // Compact color preview bar
          colorSection.addWidget(
            CardService.newImage()
              .setImageUrl('https://dummyimage.com/200x8/' + colorHex + '/' + colorHex + '.png')
              .setAltText('Current color')
          );
        });

        card.addSection(colorSection);
      }
    } catch (projectError) {
      // Silently skip if projects can't be loaded
      console.error('Failed to load projects:', projectError.message);
    }

    // Account section with logout
    const accountSection = CardService.newCardSection()
      .setHeader('Account');

    accountSection.addWidget(
      CardService.newTextButton()
        .setText('Logout')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onLogout')
        )
    );

    card.addSection(accountSection);

    // Footer with back button
    card.setFixedFooter(
      CardService.newFixedFooter()
        .setPrimaryButton(
          CardService.newTextButton()
            .setText('Back')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onBackToList')
            )
        )
    );

    return card.build();

  } catch (error) {
    return buildErrorCard(error.message);
  }
}

/**
 * Get project color from user properties
 * @param {number} projectId - Project ID
 * @returns {string|null} Color value (1-11) or null
 */
function getProjectColor(projectId) {
  return PropertiesService.getUserProperties().getProperty('PROJECT_COLOR_' + projectId);
}

/**
 * Set project color in user properties
 * @param {number} projectId - Project ID
 * @param {string} color - Color value (1-11)
 */
function setProjectColor(projectId, color) {
  if (color === '0' || !color) {
    PropertiesService.getUserProperties().deleteProperty('PROJECT_COLOR_' + projectId);
  } else {
    PropertiesService.getUserProperties().setProperty('PROJECT_COLOR_' + projectId, color);
  }
}

/**
 * Get hex color code for a Google Calendar event color
 * @param {string} colorCode - Color code (0-11)
 * @returns {string} Hex color code without #
 */
function getColorHex(colorCode) {
  var colors = {
    '0': 'CCCCCC',  // Default (gray)
    '1': '7986CB',  // Pale Blue
    '2': '33B679',  // Pale Green
    '3': '8E24AA',  // Mauve
    '4': 'E67C73',  // Pale Red
    '5': 'F6BF26',  // Yellow
    '6': 'F4511E',  // Orange
    '7': '039BE5',  // Cyan
    '8': '616161',  // Gray
    '9': '3F51B5',  // Blue
    '10': '0B8043', // Green
    '11': 'D50000'  // Red
  };
  return colors[colorCode] || 'CCCCCC';
}

/**
 * Get color name for a Google Calendar event color
 * @param {string} colorCode - Color code (0-11)
 * @returns {string} Color name
 */
function getColorName(colorCode) {
  var names = {
    '0': 'Default',
    '1': 'Pale Blue',
    '2': 'Pale Green',
    '3': 'Mauve',
    '4': 'Pale Red',
    '5': 'Yellow',
    '6': 'Orange',
    '7': 'Cyan',
    '8': 'Gray',
    '9': 'Blue',
    '10': 'Green',
    '11': 'Red'
  };
  return names[colorCode] || 'Default';
}

/**
 * Get selected calendar ID from user properties
 * @returns {string|null} Selected calendar ID
 */
function getSelectedCalendarId() {
  return PropertiesService.getUserProperties().getProperty('SELECTED_CALENDAR_ID');
}

/**
 * Set selected calendar ID in user properties
 * @param {string} calendarId - Calendar ID
 */
function setSelectedCalendarId(calendarId) {
  PropertiesService.getUserProperties().setProperty('SELECTED_CALENDAR_ID', calendarId);
}

/**
 * Build an error card
 * @param {string} message - Error message
 * @returns {Card} Error card
 */
function buildErrorCard(message) {
  return CardService.newCardBuilder()
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('Something went wrong')
        )
        .addWidget(
          CardService.newTextParagraph()
            .setText(message || 'Please try again.')
        )
    )
    .setFixedFooter(
      CardService.newFixedFooter()
        .setPrimaryButton(
          CardService.newTextButton()
            .setText('Try again')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onRefresh')
            )
        )
        .setSecondaryButton(
          CardService.newTextButton()
            .setText('Logout')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onLogout')
            )
        )
    )
    .build();
}

/**
 * Get selected task list ID from user properties
 * @returns {string|null} Selected task list ID
 */
function getSelectedTaskListId() {
  return PropertiesService.getUserProperties().getProperty('SELECTED_TASK_LIST_ID');
}

/**
 * Set selected task list ID in user properties
 * @param {string} listId - Task list ID
 */
function setSelectedTaskListId(listId) {
  PropertiesService.getUserProperties().setProperty('SELECTED_TASK_LIST_ID', listId);
}

/**
 * Format a date relative to today
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date
 */
function formatDateRelative(dateString) {
  if (!dateString) return '';

  const date = new Date(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((dateOnly - today) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays < -1) return formatDate(dateString);
  if (diffDays <= 6) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[date.getDay()];
  }
  return formatDate(dateString);
}

/**
 * Format a date for display
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date
 */
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const options = { month: 'short', day: 'numeric' };
  const today = new Date();
  if (date.getFullYear() !== today.getFullYear()) {
    options.year = 'numeric';
  }
  return date.toLocaleDateString('en-US', options);
}

/**
 * Format duration in minutes for display
 * @param {number} minutes - Duration in minutes
 * @returns {string} Formatted duration
 */
function formatDuration(minutes) {
  if (!minutes) return '';
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? hours + 'h ' + mins + 'm' : hours + 'h';
}

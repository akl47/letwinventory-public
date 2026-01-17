'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { User, Project, TaskList, Task } = require('../models');

    const user = await User.findOne({ where: { email: 'alexanderletwin@gmail.com' }, attributes: ['id'], raw: true });
    if (!user) {
      console.log('User not found, skipping task seeding');
      return;
    }

    // Get projects by name
    const projects = await Project.findAll({ attributes: ['id', 'name'], raw: true });
    const projectMap = {};
    projects.forEach(p => { projectMap[p.name] = p.id; });

    // Get task lists by name
    const taskLists = await TaskList.findAll({ attributes: ['id', 'name'], raw: true });
    const listMap = {};
    taskLists.forEach(l => { listMap[l.name] = l.id; });

    // Helper to get project ID (null if no project)
    const proj = (name) => name ? projectMap[name] : null;
    const list = (name) => listMap[name];

    // Insert tasks without parents first
    const parentTasks = [
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('Today'), name: 'Letwinventory SHIP IT', description: null, doneFlag: true, completeWithChildren: false, taskTypeEnum: 'normal', rank: '0', activeFlag: true, createdAt: new Date('2026-01-06 23:24:32.169+00'), updatedAt: new Date('2026-01-06 23:35:37.424+00') },
      { ownerUserID: user.id, projectID: null, taskListID: list('This Week'), name: 'Passport', description: null, doneFlag: false, completeWithChildren: false, taskTypeEnum: 'normal', rank: '1000', activeFlag: true, createdAt: new Date('2026-01-06 23:36:21.358+00'), updatedAt: new Date('2026-01-06 23:36:21.358+00') },
      { ownerUserID: user.id, projectID: null, taskListID: list('This Week'), name: 'Global Entry', description: null, doneFlag: false, completeWithChildren: false, taskTypeEnum: 'normal', rank: '2000', activeFlag: true, createdAt: new Date('2026-01-06 23:36:26.33+00'), updatedAt: new Date('2026-01-06 23:36:26.33+00') },
      { ownerUserID: user.id, projectID: null, taskListID: list('This Week'), name: 'Cleanarr', description: null, doneFlag: true, completeWithChildren: false, taskTypeEnum: 'normal', rank: '3000', activeFlag: true, createdAt: new Date('2026-01-06 23:36:37.418+00'), updatedAt: new Date('2026-01-11 03:24:19.798+00') },
      { ownerUserID: user.id, projectID: null, taskListID: list('Backlog'), name: 'Layout Machine Shop', description: null, doneFlag: false, completeWithChildren: false, taskTypeEnum: 'normal', rank: '1000', activeFlag: true, createdAt: new Date('2026-01-06 23:36:43.825+00'), updatedAt: new Date('2026-01-06 23:36:43.825+00') },
      { ownerUserID: user.id, projectID: null, taskListID: list('Backlog'), name: 'Requirements/Nice to have for Home', description: null, doneFlag: false, completeWithChildren: false, taskTypeEnum: 'normal', rank: '2000', activeFlag: true, createdAt: new Date('2026-01-06 23:36:57.325+00'), updatedAt: new Date('2026-01-06 23:36:57.325+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('Today'), name: 'Inventory', description: null, doneFlag: true, completeWithChildren: false, taskTypeEnum: 'normal', rank: '0', activeFlag: true, createdAt: new Date('2026-01-06 23:38:02.42+00'), updatedAt: new Date('2026-01-15 17:21:25.191+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'Letwinventory Minor Fixes', description: null, doneFlag: false, completeWithChildren: true, taskTypeEnum: 'normal', rank: '4000', activeFlag: true, createdAt: new Date('2026-01-06 23:41:53.908+00'), updatedAt: new Date('2026-01-06 23:42:11.606+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('Backlog'), name: 'Manufacturing Planning', description: null, doneFlag: false, completeWithChildren: false, taskTypeEnum: 'normal', rank: '3000', activeFlag: true, createdAt: new Date('2026-01-06 23:43:38.317+00'), updatedAt: new Date('2026-01-06 23:43:40.788+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'Move Letwinventory Production to proxmox', description: null, doneFlag: true, completeWithChildren: false, taskTypeEnum: 'normal', rank: '125', activeFlag: true, createdAt: new Date('2026-01-06 23:45:04.904+00'), updatedAt: new Date('2026-01-13 04:33:40.069+00') },
      { ownerUserID: user.id, projectID: proj('Lab'), taskListID: list('Backlog'), name: 'Reverse Proxy on VPN', description: null, doneFlag: false, completeWithChildren: false, taskTypeEnum: 'normal', rank: '4000', activeFlag: true, createdAt: new Date('2026-01-06 23:46:02.405+00'), updatedAt: new Date('2026-01-13 04:23:41.122+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('Waiting For Others'), name: 'Label Printer', description: '9434650899562107136291', doneFlag: false, completeWithChildren: false, taskTypeEnum: 'tracking', rank: '1000', activeFlag: true, createdAt: new Date('2026-01-08 17:17:49.096+00'), updatedAt: new Date('2026-01-08 17:18:10.519+00') },
      { ownerUserID: user.id, projectID: proj('Home'), taskListID: list('Today'), name: 'Laundry', description: null, doneFlag: false, completeWithChildren: false, taskTypeEnum: 'normal', rank: '11000', activeFlag: true, createdAt: new Date('2026-01-08 18:05:38.085+00'), updatedAt: new Date('2026-01-13 04:18:34.863+00') },
      { ownerUserID: user.id, projectID: proj('Home'), taskListID: list('This Week'), name: 'Clean Bedroom', description: null, doneFlag: false, completeWithChildren: false, taskTypeEnum: 'normal', rank: '9000', activeFlag: true, createdAt: new Date('2026-01-08 18:05:47.682+00'), updatedAt: new Date('2026-01-13 04:18:44.531+00') },
      { ownerUserID: user.id, projectID: proj('Home'), taskListID: list('This Week'), name: 'Vacuum Bedroom', description: null, doneFlag: false, completeWithChildren: false, taskTypeEnum: 'normal', rank: '10000', activeFlag: true, createdAt: new Date('2026-01-08 18:05:56.477+00'), updatedAt: new Date('2026-01-13 04:18:47.242+00') },
      { ownerUserID: user.id, projectID: null, taskListID: list('Waiting For Others'), name: 'VHB Tape', description: null, doneFlag: true, completeWithChildren: false, taskTypeEnum: 'normal', rank: '2000', activeFlag: true, createdAt: new Date('2026-01-10 06:38:58.714+00'), updatedAt: new Date('2026-01-11 03:24:24.134+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('Backlog'), name: 'Project Planning', description: null, doneFlag: false, completeWithChildren: false, taskTypeEnum: 'normal', rank: '5000', activeFlag: true, createdAt: new Date('2026-01-10 20:07:55.619+00'), updatedAt: new Date('2026-01-10 20:07:59.166+00') },
      { ownerUserID: user.id, projectID: proj('Pinball'), taskListID: list('Backlog'), name: 'Pinball Project', description: null, doneFlag: false, completeWithChildren: false, taskTypeEnum: 'normal', rank: '8000', activeFlag: true, createdAt: new Date('2026-01-11 09:03:17.684+00'), updatedAt: new Date('2026-01-13 04:21:35.552+00') },
      { ownerUserID: user.id, projectID: proj('Pinball'), taskListID: list('Backlog'), name: 'Pinball Inventory', description: null, doneFlag: false, completeWithChildren: false, taskTypeEnum: 'normal', rank: '9000', activeFlag: true, createdAt: new Date('2026-01-11 09:03:23.008+00'), updatedAt: new Date('2026-01-13 04:21:38.464+00') },
      { ownerUserID: user.id, projectID: proj('Lab'), taskListID: list('Today'), name: 'Fix Hera', description: null, doneFlag: true, completeWithChildren: false, taskTypeEnum: 'normal', rank: '12000', activeFlag: true, createdAt: new Date('2026-01-12 19:25:06.495+00'), updatedAt: new Date('2026-01-14 04:13:19.852+00') },
      { ownerUserID: user.id, projectID: proj('Workshop'), taskListID: list('Today'), name: 'Battery Holder', description: null, doneFlag: true, completeWithChildren: false, taskTypeEnum: 'normal', rank: '13000', activeFlag: true, createdAt: new Date('2026-01-13 04:22:50.662+00'), updatedAt: new Date('2026-01-14 04:13:07.141+00') },
      { ownerUserID: user.id, projectID: null, taskListID: list('This Week'), name: 'SHIP IT', description: null, doneFlag: true, completeWithChildren: false, taskTypeEnum: 'normal', rank: '750', activeFlag: true, createdAt: new Date('2026-01-06 23:24:32.169+00'), updatedAt: new Date('2026-01-12 22:03:55.55+00') },
    ];

    await queryInterface.bulkInsert('Tasks', parentTasks);

    // Get inserted tasks to find parent IDs
    const insertedTasks = await Task.findAll({ attributes: ['id', 'name'], raw: true });
    const taskMap = {};
    insertedTasks.forEach(t => { taskMap[t.name] = t.id; });

    // Helper to get parent task ID
    const parent = (name) => taskMap[name] || null;

    // Insert child tasks
    const childTasks = [
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'Task List Order + Dragging', description: null, doneFlag: false, completeWithChildren: false, parentTaskID: parent('Letwinventory Minor Fixes'), taskTypeEnum: 'normal', rank: '5000', activeFlag: true, createdAt: new Date('2026-01-06 23:42:12.629+00'), updatedAt: new Date('2026-01-06 23:42:12.629+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'Task card checkbox shift', description: null, doneFlag: true, completeWithChildren: false, parentTaskID: parent('Letwinventory Minor Fixes'), taskTypeEnum: 'normal', rank: '6000', activeFlag: true, createdAt: new Date('2026-01-06 23:42:28.841+00'), updatedAt: new Date('2026-01-15 17:24:55.992+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'New Task List/ Delete Task List', description: null, doneFlag: false, completeWithChildren: false, parentTaskID: parent('Letwinventory Minor Fixes'), taskTypeEnum: 'normal', rank: '7000', activeFlag: true, createdAt: new Date('2026-01-06 23:43:00.328+00'), updatedAt: new Date('2026-01-06 23:43:02.658+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'Add Manufacturer field and Manufacturer PN to parts', description: null, doneFlag: false, completeWithChildren: false, parentTaskID: parent('Letwinventory Minor Fixes'), taskTypeEnum: 'normal', rank: '8000', activeFlag: true, createdAt: new Date('2026-01-06 23:44:04.761+00'), updatedAt: new Date('2026-01-06 23:44:04.761+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'Print Barcodes', description: null, doneFlag: true, completeWithChildren: false, parentTaskID: parent('Inventory'), taskTypeEnum: 'normal', rank: '625', activeFlag: true, createdAt: new Date('2026-01-06 23:44:35.438+00'), updatedAt: new Date('2026-01-12 22:03:57.233+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'Run on proxmox', description: null, doneFlag: true, completeWithChildren: false, parentTaskID: parent('Move Letwinventory Production to proxmox'), taskTypeEnum: 'normal', rank: '62.5', activeFlag: true, createdAt: new Date('2026-01-06 23:45:34.301+00'), updatedAt: new Date('2026-01-13 04:33:42.585+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'Reverse Proxy', description: null, doneFlag: true, completeWithChildren: false, parentTaskID: parent('Move Letwinventory Production to proxmox'), taskTypeEnum: 'normal', rank: '31.25', activeFlag: true, createdAt: new Date('2026-01-06 23:45:51.875+00'), updatedAt: new Date('2026-01-13 04:33:51.219+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'Backup server', description: null, doneFlag: true, completeWithChildren: false, parentTaskID: parent('Move Letwinventory Production to proxmox'), taskTypeEnum: 'normal', rank: '46.875', activeFlag: true, createdAt: new Date('2026-01-06 23:46:32.549+00'), updatedAt: new Date('2026-01-15 17:46:09.221+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('Waiting For Others'), name: 'backup postgres', description: null, doneFlag: true, completeWithChildren: false, parentTaskID: parent('Move Letwinventory Production to proxmox'), taskTypeEnum: 'normal', rank: '750', activeFlag: true, createdAt: new Date('2026-01-06 23:46:36.265+00'), updatedAt: new Date('2026-01-13 22:13:10.27+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('Today'), name: 'Fix frontend endpoints calling backend url', description: null, doneFlag: true, completeWithChildren: false, parentTaskID: parent('Move Letwinventory Production to proxmox'), taskTypeEnum: 'normal', rank: '6000', activeFlag: true, createdAt: new Date('2026-01-07 07:35:55.54+00'), updatedAt: new Date('2026-01-07 18:04:06.627+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('Today'), name: 'PO Recieving', description: null, doneFlag: true, completeWithChildren: false, parentTaskID: parent('Inventory'), taskTypeEnum: 'normal', rank: '0', activeFlag: true, createdAt: new Date('2026-01-08 17:18:47.337+00'), updatedAt: new Date('2026-01-15 04:29:13.285+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('Today'), name: 'Barcode History', description: 'Create, Move, Split, Merge', doneFlag: true, completeWithChildren: false, parentTaskID: parent('Inventory'), taskTypeEnum: 'normal', rank: '8000', activeFlag: true, createdAt: new Date('2026-01-08 17:19:00.625+00'), updatedAt: new Date('2026-01-10 06:38:45.093+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('Today'), name: 'SN', description: null, doneFlag: true, completeWithChildren: false, parentTaskID: parent('Inventory'), taskTypeEnum: 'normal', rank: '9000', activeFlag: true, createdAt: new Date('2026-01-08 17:20:32.917+00'), updatedAt: new Date('2026-01-11 09:02:29.658+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('Today'), name: 'Lots', description: null, doneFlag: true, completeWithChildren: false, parentTaskID: parent('Inventory'), taskTypeEnum: 'normal', rank: '10000', activeFlag: true, createdAt: new Date('2026-01-08 17:20:35.672+00'), updatedAt: new Date('2026-01-11 09:02:28.516+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('Backlog'), name: 'Add New Projects', description: null, doneFlag: false, completeWithChildren: false, parentTaskID: parent('Project Planning'), taskTypeEnum: 'normal', rank: '6000', activeFlag: true, createdAt: new Date('2026-01-10 20:08:05.912+00'), updatedAt: new Date('2026-01-10 20:08:05.912+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('Backlog'), name: 'Add Tasks to google Calendar', description: null, doneFlag: false, completeWithChildren: false, parentTaskID: parent('Project Planning'), taskTypeEnum: 'normal', rank: '7000', activeFlag: true, createdAt: new Date('2026-01-10 20:08:17.226+00'), updatedAt: new Date('2026-01-10 20:08:17.227+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'logs out so quickly', description: null, doneFlag: false, completeWithChildren: false, parentTaskID: parent('Letwinventory Minor Fixes'), taskTypeEnum: 'normal', rank: '11000', activeFlag: true, createdAt: new Date('2026-01-11 09:02:25.189+00'), updatedAt: new Date('2026-01-11 09:02:25.189+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'hide chidren toggle, project tag toggles', description: null, doneFlag: false, completeWithChildren: false, parentTaskID: parent('Letwinventory Minor Fixes'), taskTypeEnum: 'normal', rank: '12000', activeFlag: true, createdAt: new Date('2026-01-11 09:04:06.045+00'), updatedAt: new Date('2026-01-11 09:04:06.045+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'Test on dev branch', description: null, doneFlag: true, completeWithChildren: false, parentTaskID: parent('Inventory'), taskTypeEnum: 'normal', rank: '13000', activeFlag: true, createdAt: new Date('2026-01-13 22:13:19.631+00'), updatedAt: new Date('2026-01-14 22:22:41.369+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'merge with master', description: null, doneFlag: true, completeWithChildren: false, parentTaskID: parent('Inventory'), taskTypeEnum: 'normal', rank: '14000', activeFlag: true, createdAt: new Date('2026-01-13 22:13:22.579+00'), updatedAt: new Date('2026-01-14 22:22:41.964+00') },
      { ownerUserID: user.id, projectID: proj('Letwinventory'), taskListID: list('This Week'), name: 'update prod', description: null, doneFlag: true, completeWithChildren: false, parentTaskID: parent('Inventory'), taskTypeEnum: 'normal', rank: '15000', activeFlag: true, createdAt: new Date('2026-01-13 22:13:30.628+00'), updatedAt: new Date('2026-01-14 22:22:42.73+00') },
    ];

    await queryInterface.bulkInsert('Tasks', childTasks);
  },

  down: (queryInterface, Sequelize) => {
    const taskNames = [
      'Letwinventory SHIP IT', 'Passport', 'Global Entry', 'Cleanarr', 'Layout Machine Shop',
      'Requirements/Nice to have for Home', 'Inventory', 'Letwinventory Minor Fixes',
      'Manufacturing Planning', 'Move Letwinventory Production to proxmox', 'Reverse Proxy on VPN',
      'Label Printer', 'Laundry', 'Clean Bedroom', 'Vacuum Bedroom', 'VHB Tape', 'Project Planning',
      'Pinball Project', 'Pinball Inventory', 'Fix Hera', 'Battery Holder', 'SHIP IT',
      'Task List Order + Dragging', 'Task card checkbox shift', 'New Task List/ Delete Task List',
      'Add Manufacturer field and Manufacturer PN to parts', 'Print Barcodes', 'Run on proxmox',
      'Reverse Proxy', 'Backup server', 'backup postgres', 'Fix frontend endpoints calling backend url',
      'PO Recieving', 'Barcode History', 'SN', 'Lots', 'Add New Projects',
      'Add Tasks to google Calendar', 'logs out so quickly', 'hide chidren toggle, project tag toggles',
      'Test on dev branch', 'merge with master', 'update prod'
    ];
    return queryInterface.bulkDelete('Tasks', { name: taskNames }, {});
  }
};

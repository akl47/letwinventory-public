'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { Project, TaskList} = require('../models')
    const project = await Project.findOne({where:{ name:'letwinventory'},attributes: ['id'],raw:true})
    const taskList = await TaskList.findOne({where:{ name:'Today'},attributes: ['id'],raw:true})
    return queryInterface.bulkInsert('Tasks', [
      {
        projectID: project.id,
        taskListID: taskList.id,
        name:"SHIP IT",
      },
    ]);
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('Tasks', null, {});
  }
};
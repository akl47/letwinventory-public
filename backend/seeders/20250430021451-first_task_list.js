'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('TaskLists', [
      {name:"Today",},
      {name:"This Week",},
      {name:"Waiting For Others",},
      {name:"Backlog",},
    ]);
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('TaskLists', null, {});
  }
};
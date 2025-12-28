'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('TaskLists', [
      {name:"Today", createdAt: new Date(), updatedAt: new Date()},
      {name:"This Week", createdAt: new Date(), updatedAt: new Date()},
      {name:"Waiting For Others", createdAt: new Date(), updatedAt: new Date()},
      {name:"Backlog", createdAt: new Date(), updatedAt: new Date()},
    ]);
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('TaskLists', null, {});
  }
};
'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.bulkInsert('TaskHistoryActionTypes', [
            { id: 1, code: 'MOVE_LIST', label: 'Moved to List', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 2, code: 'ADD_TO_PROJECT', label: 'Added to Project', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 3, code: 'ADD_PRIORITY', label: 'Priority Changed', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 4, code: 'CHANGE_STATUS', label: 'Status Changed', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
            { id: 5, code: 'CREATED', label: 'Task Created', activeFlag: true, createdAt: new Date(), updatedAt: new Date() }
        ], { ignoreDuplicates: true });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.bulkDelete('TaskHistoryActionTypes', null, {});
    }
};

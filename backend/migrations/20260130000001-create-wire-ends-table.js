'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WireEnds', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      code: {
        type: Sequelize.STRING(20),
        allowNull: false,
        unique: true,
        comment: 'Short code identifier (e.g., f-pin, m-spade)'
      },
      name: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'Display name (e.g., Female Pin, Male Spade)'
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      activeFlag: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    await queryInterface.addIndex('WireEnds', ['code']);
    await queryInterface.addIndex('WireEnds', ['activeFlag']);

    // Seed with initial termination types
    await queryInterface.bulkInsert('WireEnds', [
      { code: 'f-pin', name: 'Female Pin', description: 'Female pin terminal', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
      { code: 'm-pin', name: 'Male Pin', description: 'Male pin terminal', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
      { code: 'f-spade', name: 'Female Spade', description: 'Female spade terminal', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
      { code: 'm-spade', name: 'Male Spade', description: 'Male spade terminal', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
      { code: 'ring', name: 'Ring', description: 'Ring terminal', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
      { code: 'fork', name: 'Fork', description: 'Fork/spade terminal', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
      { code: 'ferrule', name: 'Ferrule', description: 'Wire ferrule', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
      { code: 'soldered', name: 'Solder', description: 'Soldered connection', activeFlag: true, createdAt: new Date(), updatedAt: new Date() },
      { code: 'bare', name: 'Bare', description: 'Bare wire end', activeFlag: true, createdAt: new Date(), updatedAt: new Date() }
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('WireEnds');
  }
};

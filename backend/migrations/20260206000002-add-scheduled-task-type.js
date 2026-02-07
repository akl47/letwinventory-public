'use strict';

module.exports = {
  async up(queryInterface) {
    // Add 'scheduled' to the Tasks taskTypeEnum
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_Tasks_taskTypeEnum" ADD VALUE IF NOT EXISTS 'scheduled'`
    );
    // Seed the TaskTypes lookup table
    await queryInterface.bulkInsert('TaskTypes', [{
      value: 'scheduled',
      label: 'Scheduled',
      colorClass: 'label-green',
      activeFlag: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('TaskTypes', { value: 'scheduled' });
    // Note: PostgreSQL does not support removing values from ENUMs
  }
};

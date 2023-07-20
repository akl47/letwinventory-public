module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.bulkInsert('Users', [{
      username: 'alex',
      displayName: 'Alex Letwin',
      email: 'alex@letwin.co',
      password: '$2b$10$uJJ3mHT8sjqy/VjN.M99uOHZ0gZOARu.5gBwtBIKvdaAowuxt5VDe', //abc123
      activeFlag: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }]);
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('Users', null, {});
  }
};
'use strict';
module.exports = {
  up: async (queryInterface, DataTypes) => {
    await queryInterface.createTable('Users', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      username: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: {
            len: {
                args: [1, 100],
                msg: 'Username must have between 1 and 100 characters'
            }
        }
      },
      displayName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        validate: {
            isEmail: {
                msg: 'Not a valid Email'
            }
        }
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false
      },
      activeFlag: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      createdAt: {
        allowNull: false,
        type: DataTypes.DATE
      },
      updatedAt: {
        allowNull: false,
        type: DataTypes.DATE
      }
    });
  },
  down: async (queryInterface, DataTypes) => {
    await queryInterface.dropTable('Users');
  }
};
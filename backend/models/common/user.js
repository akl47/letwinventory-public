'use strict';
const {
  Model
} = require('sequelize');
var bcrypt = require('bcrypt')

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) { }
  };
  User.init({
    googleID: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
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
    photoURL: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    activeFlag: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }
  }, {
    sequelize,
    modelName: 'User',
  });

  return User;
};
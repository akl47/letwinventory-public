'use strict';
const {
  Model
} = require('sequelize');
var bcrypt = require('bcrypt')

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {}
  };
  User.init({
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
    }
  }, {
    sequelize,
    modelName: 'User',
  });

  User.prototype.generateHash = (password)=>{
    return bcrypt.hashSync(password,bcrypt.genSaltSync(10));
  }

  User.prototype.authenticate = function(plainTextPword) {
    return bcrypt.compareSync(plainTextPword,this.password);
  }


  User.beforeCreate((user, options) => {
    user.password = user.generateHash(user.password)
    return user;
  });
  User.beforeUpdate((user, options) => {
    user.password = user.generateHash(user.password)
    return user;
  });



  return User;
};
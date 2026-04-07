'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const isPostgres = queryInterface.sequelize.getDialect() === 'postgres';

    // Check if approvalStatus column already exists (migration may have partially run before)
    const table = await queryInterface.describeTable('DesignRequirements');

    if (!table.approvalStatus) {
      // Column doesn't exist yet — add it and migrate data
      if (isPostgres) {
        await queryInterface.sequelize.query(`
          DO $$ BEGIN
            CREATE TYPE "enum_DesignRequirements_approvalStatus" AS ENUM ('draft', 'unapproved', 'approved');
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;
        `);
        await queryInterface.addColumn('DesignRequirements', 'approvalStatus', {
          type: Sequelize.ENUM('draft', 'unapproved', 'approved'),
          allowNull: false,
          defaultValue: 'draft'
        });
      } else {
        await queryInterface.addColumn('DesignRequirements', 'approvalStatus', {
          type: Sequelize.STRING(20),
          allowNull: false,
          defaultValue: 'draft'
        });
      }

      // Migrate data from approved boolean if it still exists
      if (table.approved) {
        if (isPostgres) {
          await queryInterface.sequelize.query(
            `UPDATE "DesignRequirements" SET "approvalStatus" = CASE WHEN "approved" = true THEN 'approved'::"enum_DesignRequirements_approvalStatus" ELSE 'unapproved'::"enum_DesignRequirements_approvalStatus" END`
          );
        } else {
          await queryInterface.sequelize.query(
            `UPDATE "DesignRequirements" SET "approvalStatus" = CASE WHEN "approved" = true THEN 'approved' ELSE 'unapproved' END`
          );
        }
      }
    } else if (isPostgres) {
      // Column already exists as STRING from a previous run — convert to ENUM
      await queryInterface.sequelize.query(`
        DO $$ BEGIN
          CREATE TYPE "enum_DesignRequirements_approvalStatus" AS ENUM ('draft', 'unapproved', 'approved');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `);
      await queryInterface.sequelize.query(`
        ALTER TABLE "DesignRequirements" ALTER COLUMN "approvalStatus" DROP DEFAULT;
        ALTER TABLE "DesignRequirements"
          ALTER COLUMN "approvalStatus" TYPE "enum_DesignRequirements_approvalStatus"
          USING "approvalStatus"::"enum_DesignRequirements_approvalStatus";
        ALTER TABLE "DesignRequirements"
          ALTER COLUMN "approvalStatus" SET DEFAULT 'draft'::"enum_DesignRequirements_approvalStatus";
      `);
    }

    // Remove approved column if it still exists
    if (table.approved) {
      await queryInterface.removeColumn('DesignRequirements', 'approved');
    }
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('DesignRequirements');
    const isPostgres = queryInterface.sequelize.getDialect() === 'postgres';

    if (!table.approved) {
      await queryInterface.addColumn('DesignRequirements', 'approved', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      });
    }

    if (table.approvalStatus) {
      if (isPostgres) {
        await queryInterface.sequelize.query(
          `UPDATE "DesignRequirements" SET "approved" = CASE WHEN "approvalStatus" = 'approved'::"enum_DesignRequirements_approvalStatus" THEN true ELSE false END`
        );
      } else {
        await queryInterface.sequelize.query(
          `UPDATE "DesignRequirements" SET "approved" = CASE WHEN "approvalStatus" = 'approved' THEN true ELSE false END`
        );
      }
      await queryInterface.removeColumn('DesignRequirements', 'approvalStatus');
    }

    if (isPostgres) {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_DesignRequirements_approvalStatus"');
    }
  }
};

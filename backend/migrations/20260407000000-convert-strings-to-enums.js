'use strict';

/**
 * Converts STRING columns with limited valid values to PostgreSQL ENUMs.
 * SQLite (used in tests) does not support ENUMs, so this migration skips on SQLite.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const isPostgres = queryInterface.sequelize.getDialect() === 'postgres';
    if (!isPostgres) return;

    const conversions = [
      {
        table: 'DesignRequirements', column: 'implementationStatus',
        values: "'not_implemented', 'implemented', 'validated'"
      },
      {
        table: 'RequirementHistory', column: 'changeType',
        values: "'created', 'updated', 'approved', 'unapproved', 'submitted', 'deleted', 'implemented', 'validated', 'unimplemented'"
      },
      {
        table: 'PartRevisionHistory', column: 'changeType',
        values: "'created', 'updated', 'locked', 'unlocked', 'new_revision', 'production_release'"
      },
      {
        table: 'WireHarnesses', column: 'releaseState',
        values: "'draft', 'review', 'released'"
      },
      {
        table: 'HarnessRevisionHistory', column: 'changeType',
        values: "'created', 'updated', 'submitted_review', 'rejected', 'released', 'new_revision', 'production_release'"
      },
    ];

    for (const { table, column, values } of conversions) {
      const typeName = `enum_${table}_${column}`;
      // Drop default, convert type, re-add default as ENUM value
      const [[{ column_default: colDefault }]] = await queryInterface.sequelize.query(
        `SELECT column_default FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${column}'`
      );
      await queryInterface.sequelize.query(`
        ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP DEFAULT;
        DO $$ BEGIN
          CREATE TYPE "${typeName}" AS ENUM (${values});
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        ALTER TABLE "${table}"
          ALTER COLUMN "${column}" TYPE "${typeName}"
          USING "${column}"::"${typeName}";
      `);
      // Restore default if one existed (convert from 'value'::varchar to 'value'::enum)
      if (colDefault) {
        const defaultVal = colDefault.replace(/::character varying$/, '');
        await queryInterface.sequelize.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT ${defaultVal}::"${typeName}"`
        );
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const isPostgres = queryInterface.sequelize.getDialect() === 'postgres';
    if (!isPostgres) return;

    const conversions = [
      { table: 'DesignRequirements', column: 'implementationStatus', size: 20 },
      { table: 'RequirementHistory', column: 'changeType', size: 20 },
      { table: 'PartRevisionHistory', column: 'changeType', size: 20 },
      { table: 'WireHarnesses', column: 'releaseState', size: 20 },
      { table: 'HarnessRevisionHistory', column: 'changeType', size: 50 },
    ];

    for (const { table, column, size } of conversions) {
      await queryInterface.sequelize.query(`
        ALTER TABLE "${table}"
          ALTER COLUMN "${column}" TYPE VARCHAR(${size})
          USING "${column}"::VARCHAR;
        DROP TYPE IF EXISTS "enum_${table}_${column}";
      `);
    }
  }
};

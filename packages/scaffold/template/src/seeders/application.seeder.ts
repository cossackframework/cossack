import { defineSeeder } from '@cossackframework/database';
import { ALL_PERMISSIONS } from '../lib/permissions';
import { uuidv7 } from '../lib/uuid';
import { hashPassword } from '../auth';
import { Role } from '../models/Role';
import { User } from '../models/User';
import { UserRole } from '../models/UserRole';

export default defineSeeder({
  name: 'application',
  transaction: 'auto',
  async run() {
    const now = new Date().toISOString();
    const encodedPermissions = JSON.stringify(ALL_PERMISSIONS);

    let adminRole = await Role.findOne({ where: { name: 'admin' } });
    if (!adminRole) {
      const id = uuidv7();
      await Role.insert({ id, name: 'admin', permissions: encodedPermissions, createdAt: now });
      adminRole = await Role.findOne({ where: { id } });
    } else if (adminRole.permissions !== encodedPermissions) {
      await Role.update({ id: adminRole.id }, { permissions: encodedPermissions });
    }
    if (!adminRole) throw new Error('Unable to provision the admin role.');

    const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@example.com';
    const adminPassword = process.env.ADMIN_PASSWORD ?? 'change-me-now';
    let adminUser = await User.findOne({ where: { email: adminEmail } });
    if (!adminUser) {
      const id = uuidv7();
      await User.insert({
        id,
        email: adminEmail,
        name: 'Admin',
        passwordHash: await hashPassword(adminPassword),
        avatar: null,
        meta: null,
        createdAt: now,
      });
      adminUser = await User.findOne({ where: { id } });
    }
    if (!adminUser) throw new Error('Unable to provision the admin user.');

    await UserRole.upsert(
      { userId: adminUser.id, roleId: adminRole.id, createdAt: now },
      ['userId', 'roleId'],
    );
    console.log(`  seeded   admin role + user (${adminEmail}). Set ADMIN_PASSWORD before production.`);
  },
});

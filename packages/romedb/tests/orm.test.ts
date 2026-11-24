import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    BaseEntity, Column, createORM, createTableDDL, diffSchemas, Entity, In, Index, JoinTable, ManyToMany, ManyToOne, MigrationRunner,
    OneToMany, PrimaryColumn, PrimaryGeneratedColumn, sql, UnsupportedCapabilityError, type EntitySchema, type ORM, type Relation,
} from '@cossackframework/database';
import { nodeSQLite } from '@cossackframework/database/node';
import { createRomeDB, MemoryPendingWriteStore, objects, RecordId, type RomeDB } from '../src/index';
import { RecordLink, romedb, romedbClient } from '../src/orm';
import { liveRomeDBTests, startRomeDBService, type RomeDBTestService } from '../src/testing';

// Relational entities: the shape of the dashboard's users and sessions.
@Entity('orm_users')
class User extends BaseEntity {
    @PrimaryGeneratedColumn('uuid') declare id: string;
    @Column({ type: 'varchar', unique: true }) declare email: string;
    @Column({ type: 'boolean', default: true }) declare active: boolean;
    @Column({ type: 'json', nullable: true }) declare meta: { theme: string } | null;
    @Column({ type: 'datetime' }) declare createdAt: Date;
    @OneToMany(() => Session, session => session.user) declare sessions: Relation<Session[]>;
}

@Entity('orm_sessions')
class Session extends BaseEntity {
    @PrimaryColumn({ type: 'varchar' }) declare id: string;
    @ManyToOne(() => User, user => user.sessions, { onDelete: 'CASCADE' }) declare user: Relation<User>;
    declare userId: string;
    @Column({ type: 'integer' }) declare hits: number;
}

@Entity('orm_counters')
class Counter extends BaseEntity {
    @PrimaryGeneratedColumn() declare id: number;
    @Column({ type: 'varchar' }) declare name: string;
}

// Document entities.
@Entity({ tableName: 'orm_people', model: 'document' })
@Index(['profile.city'])
class Person extends BaseEntity {
    @PrimaryGeneratedColumn('uuid') declare id: string;
    @Column({ type: 'varchar', unique: true }) declare handle: string;
    @Column({ type: 'boolean' }) declare active: boolean;
    @Column({ type: 'integer', nullable: true }) declare age: number | null;
    @Column({ type: 'json', nullable: true }) declare profile: { city: string; tags: string[] } | null;
    @Column({ type: 'datetime', nullable: true }) declare joinedAt: Date | null;
    @OneToMany(() => Article, article => article.author) declare articles: Relation<Article[]>;
}

@Entity({ tableName: 'orm_articles', model: 'document' })
class Article extends BaseEntity {
    @PrimaryColumn({ type: 'varchar' }) declare id: string;
    @Column({ type: 'varchar' }) declare title: string;
    @ManyToOne(() => Person, person => person.articles) declare author: Relation<Person>;
    declare authorId: string;
    /** A document that points at a relational row keeps the row's key. */
    @ManyToOne(() => User, undefined, { nullable: true }) declare owner: Relation<User> | null;
    declare ownerId: string | null;
    @ManyToMany(() => Person, undefined, { cascade: ['insert', 'update'] }) @JoinTable({ name: 'orm_article_reviewers' }) declare reviewers: Relation<Person[]>;
}

const entities = [User, Session, Counter, Person, Article];
const live = liveRomeDBTests() ? describe : describe.skip;

live('the ORM on RomeDB', () => {
    let service: RomeDBTestService;
    let db: RomeDB;
    let orm: ORM;

    beforeAll(async () => {
        service = await startRomeDBService();
        db = createRomeDB({ url: service.url, token: service.token, pending: new MemoryPendingWriteStore() });
        await db.preflight();
        orm = createORM({ adapter: await romedb(db), entities });
        await orm.run(async () => {
            const runner = new MigrationRunner(orm, [{
                name: '001_schema',
                up({ schema }) { for (const entity of orm.schema().entities) schema.createTable(entity as EntitySchema); },
            }]);
            await runner.up();
        });
    }, 60_000);

    afterAll(async () => { await orm?.close(); await db?.close(); await service?.stop(); });

    it('declares what RomeDB can do', () => {
        const report = orm.inspectCapabilities();
        expect(report.provider).toBe('romedb');
        expect(report.transactions).toMatchObject({ interactive: false, atomicBatch: true });
        expect(report.returning).toBe(true);
        expect(orm.driver.capabilities.documents).toBe(true);
    });

    it('applies a migration once and records it', async () => {
        await orm.run(async () => {
            const applied = await orm.sql<{ name: string }>`SELECT name FROM _cossack_migrations`;
            expect(applied.rows.map(row => row.name)).toEqual(['001_schema']);
        });
    });

    it('stores and reads relational entities', async () => {
        await orm.run(async () => {
            const user = User.create({ email: 'ada@example.com', meta: { theme: 'dark' }, createdAt: new Date('2026-01-02T03:04:05.000Z') });
            await user.save();
            expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
            // The default was filled in by the database and came back through RETURNING.
            expect(user.active).toBe(true);

            const found = await User.findOne({ where: { email: 'ada@example.com' } });
            expect(found).toBeInstanceOf(User);
            expect(found!.meta).toEqual({ theme: 'dark' });
            expect(found!.createdAt.toISOString()).toBe('2026-01-02T03:04:05.000Z');

            found!.active = false;
            await found!.save();
            expect((await User.findOne({ where: { id: user.id } }))!.active).toBe(false);

            await Session.insert([{ id: 's1', userId: user.id, hits: 1 }, { id: 's2', userId: user.id, hits: 2 }]);
            expect(await Session.count({ userId: user.id })).toBe(2);
            expect(await Session.query().sum('hits')).toBe(3);
            const updated = await Session.update({ id: 's1' }, { hits: 5 });
            expect(updated.meta.rowsAffected).toBe(1);

            const [loaded] = await User.find({ where: { id: user.id }, relations: ['sessions'] });
            expect(loaded!.sessions.map(session => session.id).sort()).toEqual(['s1', 's2']);
            const [session] = await Session.find({ where: { id: 's2' }, relations: ['user'] });
            expect(session!.user.email).toBe('ada@example.com');

            await User.upsert({ id: user.id, email: 'ada@example.com', active: true, createdAt: new Date() }, ['email']);
            expect((await User.findOne({ where: { id: user.id } }))!.active).toBe(true);

            // The foreign key is enforced, and deleting the user removes the sessions.
            await expect(Session.insert({ id: 's3', userId: 'nobody', hits: 0 })).rejects.toThrow();
            await User.delete({ id: user.id });
            expect(await Session.count()).toBe(0);
        });
    });

    it('fills an integer primary key', async () => {
        await orm.run(async () => {
            const first = await Counter.create({ name: 'a' }).save();
            const second = await Counter.create({ name: 'b' }).save();
            expect([first.id, second.id]).toEqual([1, 2]);
        });
    });

    it('keeps a question mark inside text', async () => {
        await orm.run(async () => {
            const result = await orm.sql<{ text: string; n: number }>`SELECT 'really?' AS text, ${7} AS n`;
            expect(result.rows[0]).toEqual({ text: 'really?', n: 7 });
        });
    });

    it('has no interactive transaction', async () => {
        await expect(orm.transaction(async () => {})).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    });

    it('stores and reads document entities', async () => {
        await orm.run(async () => {
            const ada = Person.create({ handle: 'ada', active: true, age: 36, profile: { city: 'London', tags: ['math'] }, joinedAt: new Date('2026-02-03T00:00:00.000Z') });
            await ada.save();
            expect(ada.id).toMatch(/^[0-9a-f-]{36}$/);
            await Person.insert({ id: 'grace', handle: 'grace', active: false, age: null, profile: null });

            const found = await Person.findOne({ where: { handle: 'ada' } });
            expect(found).toBeInstanceOf(Person);
            expect(found!.id).toBe(ada.id);
            expect(found!.active).toBe(true);
            expect(found!.age).toBe(36);
            expect(found!.profile).toEqual({ city: 'London', tags: ['math'] });
            expect(found!.joinedAt!.toISOString()).toBe('2026-02-03T00:00:00.000Z');

            // The fields are typed in the database: a boolean is a boolean, and the profile is an object.
            const stored = objects(await db.read([{ rql: 'SELECT d.id, d.active, d.profile.city AS city FROM orm_people AS d WHERE d.handle = $h', params: { $h: 'ada' } }]).then(batch => batch.results[0]!));
            expect(stored[0]!.id).toBeInstanceOf(RecordId);
            expect(stored[0]).toMatchObject({ active: true, city: 'London' });

            found!.profile = { city: 'Paris', tags: ['math', 'engines'] };
            await found!.save();
            expect((await Person.findOne({ where: { id: ada.id } }))!.profile!.city).toBe('Paris');

            expect(await Person.count({ active: true })).toBe(1);
            expect((await Person.find({ where: { id: In([ada.id, 'grace']) }, order: { handle: 'desc' } })).map(person => person.handle)).toEqual(['grace', 'ada']);
            expect((await Person.find({ order: { handle: 'asc' }, take: 1, skip: 1 })).map(person => person.handle)).toEqual(['grace']);
            // The unique column is a unique index.
            await expect(Person.insert({ handle: 'ada', active: true })).rejects.toThrow();

            // A field inside the nested object, through the query builder.
            const parisians = await Person.query('p').where(sql.fragment`${sql.id('p', 'profile', 'city')} = ${'Paris'}`).getMany();
            expect(parisians.map(person => person.handle)).toEqual(['ada']);
        });
    });

    it('links document entities with record links', async () => {
        await orm.run(async () => {
            const owner = await User.create({ email: 'owner@example.com', meta: null, createdAt: new Date() }).save();
            const ada = (await Person.findOne({ where: { handle: 'ada' } }))!;
            const article = Article.create({ id: 'engines', title: 'Engines' });
            article.author = ada;
            article.owner = owner;
            await article.save();
            await Article.insert({ id: 'notes', title: 'Notes', authorId: ada.id, ownerId: null });

            // The link to a document is a record; the link to a relational row is its key.
            const stored = objects((await db.read([{ rql: 'SELECT d.author_id, d.owner_id, record::fetch(d.author_id) AS author FROM orm_articles AS d WHERE d.id = $id', params: { $id: new RecordId('orm_articles', 'engines') } }])).results[0]!);
            expect(stored[0]!.author_id).toBeInstanceOf(RecordId);
            expect((stored[0]!.author_id as RecordId).table).toBe('orm_people');
            expect(stored[0]!.owner_id).toBe(owner.id);
            expect((stored[0]!.author as { handle: string }).handle).toBe('ada');

            const [loaded] = await Article.find({ where: { id: 'engines' }, relations: ['author', 'owner'] });
            expect(loaded!.authorId).toBe(ada.id);
            expect(loaded!.author.handle).toBe('ada');
            expect(loaded!.owner!.email).toBe('owner@example.com');

            const [person] = await Person.find({ where: { id: ada.id }, relations: ['articles'] });
            expect(person!.articles.map(item => item.id).sort()).toEqual(['engines', 'notes']);
            expect(await Article.count({ authorId: ada.id })).toBe(2);

            // A many-to-many relation keeps the two keys in a relational join table.
            const grace = (await Person.findOne({ where: { id: 'grace' } }))!;
            loaded!.reviewers = [ada, grace];
            await loaded!.save();
            const [reviewed] = await Article.find({ where: { id: 'engines' }, relations: ['reviewers'] });
            expect(reviewed!.reviewers.map(person => person.handle).sort()).toEqual(['ada', 'grace']);
            const joined = await orm.sql<{ orm_people_id: string }>`SELECT orm_people_id FROM orm_article_reviewers ORDER BY orm_people_id`;
            expect(joined.rows.map(row => row.orm_people_id).sort()).toEqual([ada.id, 'grace'].sort());

            await loaded!.remove();
            expect(await Article.count()).toBe(1);
        });
    });

    it('gives the RomeDB instance for RomeQL the ORM does not write', async () => {
        await orm.run(async () => {
            expect(romedbClient()).toBe(db);
            const ada = (await Person.findOne({ where: { handle: 'ada' } }))!;
            // A record link passed to the ORM's sql tag is sent as a record.
            const rows = await orm.sql<{ title: string; author_id: RecordLink }>`SELECT d.title, d.author_id FROM orm_articles AS d WHERE d.author_id = ${new RecordLink('orm_people', ada.id)}`;
            expect(rows.rows.map(row => row.title)).toEqual(['Notes']);
            expect(rows.rows[0]!.author_id).toBeInstanceOf(RecordLink);
            expect(String(rows.rows[0]!.author_id)).toBe(`orm_people:${ada.id}`);
        });
        expect(romedbClient(orm)).toBe(db);
    });

    it('reads the schema back with no difference from the models', async () => {
        const physical = await orm.introspect();
        const tables = physical.entities.map(entity => [entity.tableName, entity.model ?? 'relational']);
        expect(tables).toContainEqual(['orm_users', 'relational']);
        expect(tables).toContainEqual(['orm_people', 'document']);
        expect(physical.entities.find(entity => entity.tableName === 'orm_people')!.indexes).toEqual([
            { name: 'idx_orm_people_profile.city', columns: ['profile.city'], unique: false },
            { name: 'uq_orm_people_handle', columns: ['handle'], unique: true },
        ]);
        const sessions = physical.entities.find(entity => entity.tableName === 'orm_sessions')!;
        expect(sessions.relations).toMatchObject([{ joinColumn: 'user_id', targetTableName: 'orm_users', referencedColumn: 'id', onDelete: 'CASCADE' }]);
        const diff = diffSchemas(physical, orm.schema(), { allowDestructive: true });
        expect(diff.operations).toEqual([]);
    });
});

describe('document entities need RomeDB', () => {
    it('refuses a document entity on another database', async () => {
        const adapter = await nodeSQLite();
        expect(() => createORM({ adapter, entities: [Person, Article, User, Session] })).toThrow(/document entity/);
        await adapter.driver.close();
    });

    it('creates a document table without columns', () => {
        const person = { modelName: 'Person', tableName: 'people', columns: [], relations: [], virtual: false, model: 'document' as const,
            indexes: [{ name: 'people_city', columns: ['profile.city'], unique: false }] };
        expect(createTableDDL(person, { name: 'sqlite', quoteIdentifier: (value: string) => `"${value}"` } as never)).toEqual([
            'CREATE TABLE "people"',
            'CREATE INDEX "people_city" ON "people" ("profile"."city")',
        ]);
    });
});

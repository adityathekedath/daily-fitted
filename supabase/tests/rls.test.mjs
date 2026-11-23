// Database tests: runs every migration in an in-process Postgres (PGlite) and
// checks the privacy rules by acting as different signed-in users.
//
// Run with: npm run test:db

import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let db;

before(async () => {
  db = await PGlite.create();
  await db.exec(readFileSync(join(root, 'tests/supabase-stubs.sql'), 'utf8'));
  const migrations = readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrations) {
    await db.exec(readFileSync(join(root, 'migrations', file), 'utf8'));
  }
});

after(async () => db?.close());

// --- helpers -------------------------------------------------------------------

/** Signs up a user the way the app does (with the 18+ confirmation). */
async function signUp(meta = { age_confirmed: true }) {
  const id = randomUUID();
  await db.query('insert into auth.users (id, raw_user_meta_data) values ($1, $2)', [id, meta]);
  return id;
}

/** Runs `fn` as a signed-in user, the same way the API's user_transaction does. */
async function asUser(userId, fn) {
  return db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    return fn(tx);
  });
}

async function asAnon(fn) {
  return db.transaction(async (tx) => {
    await tx.query('set local role anon');
    return fn(tx);
  });
}

/** Uploads a photo and posts an outfit as `userId`. Returns { outfitId, path }. */
async function postOutfit(userId) {
  const path = `${userId}/${randomUUID()}.jpg`;
  return asUser(userId, async (tx) => {
    await tx.query("insert into storage.objects (bucket_id, name) values ('outfit-photos', $1)", [path]);
    const { rows } = await tx.query(
      'insert into public.outfits (user_id, photo_path) values ($1, $2) returning id',
      [userId, path],
    );
    return { outfitId: rows[0].id, path };
  });
}

async function befriend(a, b) {
  await asUser(a, (tx) =>
    tx.query('insert into public.friendships (requester_id, addressee_id) values ($1, $2)', [a, b]),
  );
  await asUser(b, (tx) =>
    tx.query(
      "update public.friendships set status = 'accepted', responded_at = now() where requester_id = $1 and addressee_id = $2",
      [a, b],
    ),
  );
}

async function visibleOutfitIds(viewer) {
  return asUser(viewer, async (tx) => {
    const { rows } = await tx.query('select id from public.outfits');
    return rows.map((r) => r.id);
  });
}

async function canSeePhoto(viewer, path) {
  return asUser(viewer, async (tx) => {
    const { rows } = await tx.query('select 1 from storage.objects where name = $1', [path]);
    return rows.length === 1;
  });
}

// --- tests ---------------------------------------------------------------------

describe('sign-up', () => {
  test('creates a private profile', async () => {
    const id = await signUp();
    const { rows } = await db.query('select is_private, age_confirmed_at from public.profiles where id = $1', [
      id,
    ]);
    assert.equal(rows[0].is_private, true);
    assert.ok(rows[0].age_confirmed_at);
  });

  test('is refused without the 18+ confirmation', async () => {
    await assert.rejects(signUp({}), /18 and older/);
  });
});

describe('outfit visibility', () => {
  test('owner sees their outfit; a stranger does not', async () => {
    const owner = await signUp();
    const stranger = await signUp();
    const { outfitId, path } = await postOutfit(owner);

    assert.ok((await visibleOutfitIds(owner)).includes(outfitId));
    assert.ok(!(await visibleOutfitIds(stranger)).includes(outfitId));
    assert.equal(await canSeePhoto(stranger, path), false);
  });

  test('an accepted friend sees the outfit and its photo', async () => {
    const owner = await signUp();
    const friend = await signUp();
    const { outfitId, path } = await postOutfit(owner);
    await befriend(owner, friend);

    assert.ok((await visibleOutfitIds(friend)).includes(outfitId));
    assert.equal(await canSeePhoto(friend, path), true);
  });

  test('a pending friend request does not grant access', async () => {
    const owner = await signUp();
    const requester = await signUp();
    const { outfitId } = await postOutfit(owner);
    await asUser(requester, (tx) =>
      tx.query('insert into public.friendships (requester_id, addressee_id) values ($1, $2)', [
        requester,
        owner,
      ]),
    );

    assert.ok(!(await visibleOutfitIds(requester)).includes(outfitId));
  });

  test('blocking a friend hides outfits and photos', async () => {
    const owner = await signUp();
    const friend = await signUp();
    const { outfitId, path } = await postOutfit(owner);
    await befriend(owner, friend);
    await asUser(owner, (tx) =>
      tx.query('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [owner, friend]),
    );

    assert.ok(!(await visibleOutfitIds(friend)).includes(outfitId));
    assert.equal(await canSeePhoto(friend, path), false);
  });

  test('signed-out visitors cannot read outfits at all', async () => {
    await assert.rejects(
      asAnon((tx) => tx.query('select * from public.outfits')),
      /permission denied/,
    );
  });
});

describe('writes', () => {
  test("cannot post an outfit as someone else", async () => {
    const me = await signUp();
    const victim = await signUp();
    await assert.rejects(
      asUser(me, (tx) =>
        tx.query('insert into public.outfits (user_id, photo_path) values ($1, $2)', [
          victim,
          `${victim}/${randomUUID()}.jpg`,
        ]),
      ),
      /row-level security/,
    );
  });

  test("cannot attach a photo from another user's folder", async () => {
    const me = await signUp();
    const other = await signUp();
    await assert.rejects(
      asUser(me, (tx) =>
        tx.query('insert into public.outfits (user_id, photo_path) values ($1, $2)', [
          me,
          `${other}/${randomUUID()}.jpg`,
        ]),
      ),
      /outfits_photo_in_own_folder/,
    );
  });

  test("cannot upload into another user's storage folder", async () => {
    const me = await signUp();
    const other = await signUp();
    await assert.rejects(
      asUser(me, (tx) =>
        tx.query("insert into storage.objects (bucket_id, name) values ('outfit-photos', $1)", [
          `${other}/${randomUUID()}.jpg`,
        ]),
      ),
      /row-level security/,
    );
  });

  test('cannot change your own age confirmation', async () => {
    const me = await signUp();
    await assert.rejects(
      asUser(me, (tx) => tx.query('update public.profiles set age_confirmed_at = now() where id = $1', [me])),
      /permission denied/,
    );
  });

  test("cannot edit someone else's outfit", async () => {
    const owner = await signUp();
    const other = await signUp();
    const { outfitId } = await postOutfit(owner);
    await asUser(other, (tx) =>
      tx.query("update public.outfits set caption = 'hacked' where id = $1", [outfitId]),
    );
    const { rows } = await db.query('select caption from public.outfits where id = $1', [outfitId]);
    assert.equal(rows[0].caption, null);
  });

  test('cannot accept a friend request you sent yourself', async () => {
    const a = await signUp();
    const b = await signUp();
    await asUser(a, (tx) =>
      tx.query('insert into public.friendships (requester_id, addressee_id) values ($1, $2)', [a, b]),
    );
    await asUser(a, (tx) =>
      tx.query("update public.friendships set status = 'accepted' where requester_id = $1", [a]),
    );
    const { rows } = await db.query('select status from public.friendships where requester_id = $1', [a]);
    assert.equal(rows[0].status, 'pending');
  });
});

describe('detection job queue', () => {
  test('every new outfit gets a queued detection job', async () => {
    const me = await signUp();
    const { outfitId } = await postOutfit(me);
    const { rows } = await db.query('select status, attempts from public.detection_jobs where outfit_id = $1', [
      outfitId,
    ]);
    assert.deepEqual(rows, [{ status: 'queued', attempts: 0 }]);
  });

  test('app users cannot read the queue', async () => {
    const me = await signUp();
    await assert.rejects(
      asUser(me, (tx) => tx.query('select * from public.detection_jobs')),
      /permission denied/,
    );
  });

  test('the internal are_friends() helper is not callable by app users', async () => {
    const me = await signUp();
    await assert.rejects(
      asUser(me, (tx) => tx.query('select public.are_friends($1, $1)', [me])),
      /permission denied/,
    );
  });
});

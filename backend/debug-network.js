const { Client } = require('pg');
const connectionString = 'postgresql://postgres:XkccpEaqaAMP0rJU@db.uuaifdcikjtspbnnkovj.supabase.co:5432/postgres';

const client = new Client({
  connectionString: connectionString,
});

client.connect()
  .then(() => {
    console.log('SUCCESS: Raw connection to Supabase established!');
    return client.query('SELECT current_database();');
  })
  .then(res => {
    console.log('Database:', res.rows[0].current_database);
    process.exit(0);
  })
  .catch(err => {
    console.error('FAILURE: Network error connecting to Supabase');
    console.error('Error Code:', err.code);
    console.error('Message:', err.message);
    process.exit(1);
  });

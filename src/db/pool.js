import mysql from 'mysql2/promise';
import { MYSQL } from '../config/env.js';

export const pool = mysql.createPool({
  host: MYSQL.host,
  port: MYSQL.port,
  user: MYSQL.user,
  password: MYSQL.password,
  database: MYSQL.database,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

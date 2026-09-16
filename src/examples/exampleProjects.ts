import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CorgiExample {
  title: string;
  link?: string;
  publicLink?: string;
  path?: string;
  files?: string[];
  shouldSeed?: boolean;
}

export const corgiExamplesJsonPattern = /^(?!.*\.corgi\.json$|.*corgi-\.json$).*corgi(-[a-zA-Z0-9]+)?\.json$/;

export const exampleProjects: CorgiExample[] = [
  {
    title: '2 postgres databases with echo logs',
    link: 'https://github.com/Andriiklymiuk/corgi_examples/blob/main/echoExample.corgi-compose.yml',
    publicLink: 'https://github.com/Andriiklymiuk/corgi_examples/blob/main/echoExample.corgi-compose.yml',
    path: 'echo_example_with_postgres_databases'
  },
  {
    title: "Postgres with data + go + react native",
    link: "https://github.com/Andriiklymiuk/corgi_examples/blob/main/postgres/postgres-seeded-go-reactnative.corgi-compose.yml",
    publicLink: "https://github.com/Andriiklymiuk/corgi/tree/main/examples/postgres",
    path: "postgres_with_data_go_reactnative_example",
    files: [
      "https://github.com/Andriiklymiuk/corgi_examples/blob/main/postgres/users_dump.sql"
    ],
    shouldSeed: true
  },
  {
    title: "Rabbitmq + go + nestjs servers ",
    link: "https://github.com/Andriiklymiuk/corgi_examples/blob/main/rabbitmq/rabbitmq-go-nestjs.corgi-compose.yml",
    publicLink: "https://github.com/Andriiklymiuk/corgi_examples/blob/main/rabbitmq/rabbitmq-go-nestjs.corgi-compose.yml",
    path: "rabbitmq_go_nestjs_queue_example"
  },
  {
    title: "AWS SQS + postgres + go + deno servers ",
    link: "https://github.com/Andriiklymiuk/corgi_examples/blob/main/aws_sqs/aws_sqs_postgres_go_deno.corgi-compose.yml",
    publicLink: "https://github.com/Andriiklymiuk/corgi_examples/blob/main/aws_sqs/aws_sqs_postgres_go_deno.corgi-compose.yml",
    path: "aws_sqs_postgres_go_deno_queue_example"
  },
  {
    title: "MongoDb + go server",
    link: "https://github.com/Andriiklymiuk/corgi_examples/blob/main/mongodb/mongodb-go.corgi-compose.yml",
    publicLink: "https://github.com/Andriiklymiuk/corgi_examples/blob/main/mongodb/mongodb-go.corgi-compose.yml",
    path: "mongodb_go_example"
  },
  {
    title: "Redis + bun server + expo app",
    link: "https://github.com/Andriiklymiuk/corgi_examples/blob/main/redis/redis-bun-expo.corgi-compose.yml",
    publicLink: "https://github.com/Andriiklymiuk/corgi_examples/blob/main/redis/redis-bun-expo.corgi-compose.yml",
    path: "redis_bun_expo_example"
  },
  {
    title: "Hono server, websocket + expo app",
    link: "https://github.com/Andriiklymiuk/corgi_examples/blob/main/honoExpoTodo/hono-bun-expo.corgi-compose.yml",
    publicLink: "https://github.com/Andriiklymiuk/corgi_examples/blob/main/honoExpoTodo/hono-bun-expo.corgi-compose.yml",
    path: "hono_expo_example"
  },
  {
    title: "Hono server, graphql, redis, postgres + nextjs, golden retriever",
    link: "https://github.com/Andriiklymiuk/corgi_examples/blob/main/honoNestRecipeApp/hono-nest-postgres-redis.corgi-compose.yml",
    publicLink: "https://github.com/Andriiklymiuk/corgi_examples/blob/main/honoNestRecipeApp/hono-nest-postgres-redis.corgi-compose.yml",
    path: "hono_nextjs_example"
  },
];
/** The examples a workspace carries itself: every corgi-*.json in its root. */
export function customExamples(workspacePath: string | undefined): CorgiExample[] {
  if (!workspacePath) {
    return [];
  }
  const all: CorgiExample[] = [];
  try {
    for (const file of fs.readdirSync(workspacePath)) {
      if (!corgiExamplesJsonPattern.test(file)) {
        continue;
      }
      const raw = fs.readFileSync(path.join(workspacePath, file), 'utf-8');
      if (!raw) {
        continue;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        all.push(...parsed.filter((e) => e && typeof e.title === 'string'));
      }
    }
  } catch (error) {
    console.error('Error reading corgi example files:', error);
  }
  return all;
}

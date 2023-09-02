export interface CorgiExample {
  title: string;
  link: string;
  publicLink?: string;
  path?: string;
}

export const corgiExamplesFileName = 'corgi-examples.json';

export const exampleProjects: CorgiExample[] = [
  {
    title: '2 postgres databases with echo logs',
    link: 'https://github.com/Andriiklymiuk/corgi/blob/main/examples/0example.corgi-compose.yml',
    publicLink: 'https://github.com/Andriiklymiuk/corgi/blob/main/examples/0example.corgi-compose.yml'
  },
  {
    title: "Rabbitmq + go + nestjs servers ",
    link: "https://github.com/Andriiklymiuk/corgi/blob/main/examples/rabbitmq/rabbitmq-go-nestjs.corgi-compose.yml",
    publicLink: "https://github.com/Andriiklymiuk/corgi/blob/main/examples/rabbitmq/rabbitmq-go-nestjs.corgi-compose.yml",
    path: "rabbitmq_go_nestjs_queue_example"
  },
  {
    title: "AWS SQS + postgres + go + deno servers ",
    link: "https://github.com/Andriiklymiuk/corgi/blob/main/examples/aws_sqs/aws_sqs_postgres_go_deno.corgi-compose.yml",
    publicLink: "https://github.com/Andriiklymiuk/corgi/blob/main/examples/aws_sqs/aws_sqs_postgres_go_deno.corgi-compose.yml",
    path: "aws_sqs_postgres_go_deno_queue_example"
  },
];
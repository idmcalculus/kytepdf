import * as path from "node:path";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const serviceName = config.get("serviceName") || "kytepdf-gateway";
const containerPort = config.getNumber("containerPort") || 8080;
const instanceType = config.get("instanceType") || "t3.micro";
const allowCidr = config.get("allowCidr") || "0.0.0.0/0";
const maxFileSizeMb = config.getNumber("maxFileSizeMb") || 50;
const apiKey = config.getSecret("apiKey") || pulumi.secret("");
const corsOrigin = config.get("corsOrigin") || "*";

const vpc = aws.ec2.getVpcOutput({ default: true });
const subnetIds = aws.ec2.getSubnetIdsOutput({ vpcId: vpc.id });

const securityGroup = new aws.ec2.SecurityGroup(`${serviceName}-sg`, {
  vpcId: vpc.id,
  description: "Gateway HTTP access",
  ingress: [
    {
      protocol: "tcp",
      fromPort: containerPort,
      toPort: containerPort,
      cidrBlocks: [allowCidr],
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});

const cluster = new aws.ecs.Cluster(`${serviceName}-cluster`, {});

const instanceRole = new aws.iam.Role(`${serviceName}-ecs-instance-role`, {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "ec2.amazonaws.com" }),
});

new aws.iam.RolePolicyAttachment(`${serviceName}-ecs-instance-policy`, {
  role: instanceRole.name,
  policyArn: aws.iam.ManagedPolicy.AmazonEC2ContainerServiceforEC2Role,
});

new aws.iam.RolePolicyAttachment(`${serviceName}-ecs-ecr-policy`, {
  role: instanceRole.name,
  policyArn: aws.iam.ManagedPolicy.AmazonEC2ContainerRegistryReadOnly,
});

const instanceProfile = new aws.iam.InstanceProfile(`${serviceName}-ecs-profile`, {
  role: instanceRole.name,
});

const ecsAmi = aws.ssm.getParameterOutput({
  name: "/aws/service/ecs/optimized-ami/amazon-linux-2/recommended/image_id",
});

const instance = new aws.ec2.Instance(`${serviceName}-instance`, {
  ami: ecsAmi.value,
  instanceType,
  subnetId: subnetIds.ids[0],
  vpcSecurityGroupIds: [securityGroup.id],
  iamInstanceProfile: instanceProfile.name,
  associatePublicIpAddress: true,
  userData: pulumi.interpolate`#!/bin/bash
echo "ECS_CLUSTER=${cluster.name}" >> /etc/ecs/ecs.config
`,
});

const repo = new awsx.ecr.Repository(`${serviceName}-repo`, {
  forceDelete: true,
});

const image = new awsx.ecr.Image(`${serviceName}-image`, {
  repositoryUrl: repo.url,
  path: path.join(__dirname, "..", "cloud-gateway"),
  platform: "linux/amd64",
});

const taskExecutionRole = new aws.iam.Role(`${serviceName}-task-exec-role`, {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "ecs-tasks.amazonaws.com" }),
});

new aws.iam.RolePolicyAttachment(`${serviceName}-task-exec-policy`, {
  role: taskExecutionRole.name,
  policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy,
});

const logGroup = new aws.cloudwatch.LogGroup(`${serviceName}-logs`, {
  retentionInDays: 7,
});

const taskDefinition = new aws.ecs.TaskDefinition(`${serviceName}-task`, {
  family: serviceName,
  requiresCompatibilities: ["EC2"],
  networkMode: "bridge",
  cpu: "256",
  memory: "512",
  executionRoleArn: taskExecutionRole.arn,
  taskRoleArn: taskExecutionRole.arn,
  containerDefinitions: pulumi
    .all([image.imageUri, apiKey, logGroup.name])
    .apply(([imageUri, resolvedApiKey, logGroupName]) =>
      JSON.stringify([
        {
          name: "gateway",
          image: imageUri,
          portMappings: [
            {
              containerPort,
              hostPort: containerPort,
              protocol: "tcp",
            },
          ],
          environment: [
            { name: "PORT", value: String(containerPort) },
            { name: "MAX_FILE_SIZE_MB", value: String(maxFileSizeMb) },
            { name: "CORS_ORIGIN", value: corsOrigin },
            { name: "CLOUD_GATEWAY_API_KEY", value: resolvedApiKey || "" },
          ],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroupName,
              "awslogs-region": aws.config.region,
              "awslogs-stream-prefix": "ecs",
            },
          },
        },
      ]),
    ),
});

const service = new aws.ecs.Service(`${serviceName}-service`, {
  cluster: cluster.arn,
  taskDefinition: taskDefinition.arn,
  desiredCount: 1,
  launchType: "EC2",
  deploymentMinimumHealthyPercent: 0,
  deploymentMaximumPercent: 100,
});

export const publicUrl = pulumi.interpolate`http://${instance.publicIp}:${containerPort}`;
export const clusterName = cluster.name;
export const repositoryUrl = repo.url;
export const ecsServiceName = service.name;

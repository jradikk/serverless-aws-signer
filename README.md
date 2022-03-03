# Serverless plugin for Lambda functions signing using AWS Signer service
[![serverless](http://public.serverless.com/badges/v3.svg)](https://www.serverless.com)
[![Build Status](https://travis-ci.org/jradikk/serverless-aws-signer.svg?branch=master)](https://travis-ci.org/jradikk/serverless-aws-signer)
[![npm version](https://badge.fury.io/js/serverless-aws-signer.svg)](https://badge.fury.io/js/serverless-aws-signer)
[![MIT licensed](https://img.shields.io/badge/license-MIT-blue.svg)](https://raw.githubusercontent.com/jradikk/serverless-aws-signer/master/LICENSE)
[![npm downloads](https://img.shields.io/npm/dt/serverless-aws-signer.svg?style=flat)](https://www.npmjs.com/package/serverless-aws-signer)
## Installation

`npm install serverless-aws-signer`

## Configuration

```yaml
# add to your serverless.yml

plugins:
  - serverless-aws-signer

custom:
  signer:
    retain: false                                  # Whether to retain signing Profile and S3 buckets during the project termination (`sls remove` command), if they were created by the plugin
    source:
      s3:
        bucketName: source-bucket-for-signer       # [REQUIRED] Source bucket for AWS Signer where zip archive with lambda code will be uploaded
        key: lambda-object-name                    # Filename of the lambda zip archive at S3 (copied by the plugin). Is ignored in case of individually packaged functions
    destination:
      s3:
        bucketName: source-bucket-for-signer       # Destination bucket for AWS Signer where signed zip archive with lambda will appear after signing. Can be the same as source bucket
        prefix: signed-                            # Prefix to be added to the name of the signed archive
    profileName: signing-profile                   # AWS Signing Profle name. Currently needs to be created separately
    signingPolicy: Enforce                         # Whether to disallow code updated signed improperly or just fire a warning
    description: signing-description               # Description of the signing profile displayed in AWS 

package:
    indvidually: true                              # Plugin works with both individually and commonly packaged functions
   
functions:
  signee:
    handler: index.lambda_handler
    signer:                                         # Any global parameter can be overridden by lambda individual configuration. package.individually.true needs to be enabled for the plugin to parse function configs
      profileName: signing-profile
      signingPolicy: Enforce

```
---

## Default Configuration

All parameters except for source S3 bucket and Signing profile can be ommitted. In this case they are taken from default values:

* `signer.source.s3.key` - defaults to `function_name` + `unix_timestamp`
* `signer.destination.s3.bucketName` - defaults to the source bucketName value
* `signer.destination.s3.prefix` - defaults to `signed-`
* `signingPolicy` - defaults to `Enforce`
* `retain` - defaults to `true`
* `description` - defaults to `Not set`

## Default behavior

If an S3 bucket or a Signing profile are specified in configuration but couldn't be found in target AWS account, plugin will attempt to create them using AWS SDK (Not CloudFormation template). 

When project gets terminated, plugin attempts to delete signingProfiles and S3buckets specified in corresponding configuration, unless `retain` option is set to `true`. Default value is true

In case one needs to change a signing provider of a lambda function, he'll need to recreate the lambda function, otherwise, AWS will reject the zip code with Lambda code, since it will be signed by a different signing Provider than the one specified in serverless configuration. It happens because signing is done before the CloudFormation template gets deployed
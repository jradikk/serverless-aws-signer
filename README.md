# Serverless plugin for Lambda functions signing using AWS Signer service

## Installation

`npm install serverless-aws-signer`

## Configuration

```yaml
# add to your serverless.yml

plugins:
  - serverless-aws-signer

custom:
  signer:
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

All parameters except for source S3 bucket and Signing profile can be ommitted. In this case they are taked from default values:

* `signer.source.s3.key` - defaults to `function_name` + `unix_timestamp`
* `signer.destination.s3.bucketName` - defaults to the source bucketName value
* `signer.destination.s3.prefix` - defaults to `signed-`
* `signingPolicy` - defaults to `Enforce`

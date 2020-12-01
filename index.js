'use strict';

const fs = require('fs');

const signersMethods = require('./src/SignersMethods');
const cloudFormationGenerator = require('./src/cloudFormationGenerator');
class ServerlessPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.commands = {
      signer: {
        usage: 'Signs Lambda code using AWS Signer',
        lifecycleEvents: ['sign', 'updateCloudFormation'],
        options: {
          function: {
            usage:
              'Specify the function you want to sign ' +
              '(e.g. "--function main or "-f secondary")',
            required: true,
            shortcut: 'f',
          },
        },
      },
    };

    this.hooks = {
      'after:package:createDeploymentArtifacts': this.signLambdas.bind(this),
      'before:package:finalize': this.addSigningConfigurationToCloudFormation.bind(this),
      'signer:sign': this.signLambdas.bind(this),
      'signer:updateCloudFormation': this.addSigningConfigurationToCloudFormation.bind(this)
    };
  }

  signLambdas = async(serverless, options) => {

    this.serverless.cli.log('Signing functions');

    var signerConfiguration = this.serverless.service.custom.signer;

    
    // Copy deployment artifact to S3
    const fileContent = fs.readFileSync(this.serverless.service.package.artifact);

    var S3Response = await this.serverless.providers.aws.request('S3', 'upload', {
      Bucket: signerConfiguration.source.s3.bucketName, 
      Key:  signerConfiguration.source.s3.key,
      Body: fileContent
    })

    const S3ObjectVersion = S3Response.VersionId

    var sign_params = {
      source: {
        s3: {
          bucketName: signerConfiguration.source.s3.bucketName,
          key: signerConfiguration.source.s3.key,
          version: S3ObjectVersion
        }
      },
      destination: {
        s3: {
          bucketName: signerConfiguration.destination.s3.bucketName,
          prefix: signerConfiguration.destination.s3.prefix,
        }
      },
      profileName: signerConfiguration.profileName
    }

    this.serverless.service.custom.signer;
    
    sign_params.source.s3.version = S3ObjectVersion;

    // Start signing job
    var signJob = await this.serverless.providers.aws.request('Signer', 'startSigningJob', sign_params)
    
    // Wait until Signing job successfully completes
    var status = ""
    while ( status !== "Succeeded" && status !== "Failed" ) {
      var jobStatus = await this.serverless.providers.aws.request('Signer', 'describeSigningJob', {jobId: signJob.jobId})
      status = jobStatus.status
    }
    
    if (status === "Failed") {
      throw new Error(`Signing job has failed with ${jobStatus.statusReason} reason`)
    }

    var signedCodeLocation = jobStatus.signedObject.s3

    // Replace current zip archive of deployment archive with the same payload but signed
      const { Body } = await this.serverless.providers.aws.request('S3', 'getObject', {
        Bucket: signedCodeLocation.bucketName, 
        Key:  signedCodeLocation.key
      })
      await fs.writeFile(this.serverless.service.package.artifact, Body)
  }

  addSigningConfigurationToCloudFormation = async(serverless, options) => {
    this.serverless.cli.log('Updating signing configuration');
    var cloudFormationResources = this.serverless.service.provider.compiledCloudFormationTemplate.Resources;
    var profileArn = await signersMethods.getProfileParamByName(this.serverless.service.custom.signer.profileName, 'profileVersionArn', this.serverless)
    
    if (!profileArn) {
      throw new Error("Signing profile not found")
    }

    const signingCFTemplate=cloudFormationGenerator.codeSigningConfig(profileArn, this.serverless.service.custom.signer.signingPolicy)

    cloudFormationResources.CodeSigningConfig = signingCFTemplate

    for (let resource in cloudFormationResources){
      if (cloudFormationResources[resource].Type === 'AWS::Lambda::Function') {
        cloudFormationResources[resource].Properties.CodeSigningConfigArn = {"Ref": "CodeSigningConfig"}
      }
    }
  }
}

module.exports = ServerlessPlugin;

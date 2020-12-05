'use strict';

const fs = require('fs');
const _ = require('lodash');

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



  generateSignerConfiguration() {
    var signerProcesses = {};

    const defaultConfig = {
      source: {
        s3: {
          key: 'common'+'-'+Math.floor(+new Date() / 1000),
        }
      },
      destination: {
        s3: {
          prefix: "signed-"
        }
      },
      profileName: this.serverless.service.service,
      signingPolicy: "Enforce"
    }

    const lambda_functions = this.serverless.service.functions;

    if (this.serverless.service.package.individually === true) {  
      for (let lambda_function in lambda_functions) {
        // Since merge mutates the first object in a set, we need to pass an empty object. Otherwise, it'll rewrite the default configuration
        // https://stackoverflow.com/questions/19965844/lodash-difference-between-extend-assign-and-merge#comment57512843_19966511
        const mergedConfig = _.merge({}, defaultConfig, this.serverless.service.custom.signer, lambda_functions[lambda_function].signer);
        signerProcesses[lambda_function] = {
          signerConfiguration: mergedConfig,
          packageArtifact: lambda_functions[lambda_function].package.artifact
        }
        try {
          // TODO: Remove this check with proper validation
          if (!signerProcesses[lambda_function].signerConfiguration.source.s3.bucketName) {
            throw new this.serverless.classes.Error("No bucket name was specified");
          }
          if (!signerProcesses[lambda_function].signerConfiguration.destination.s3.bucketName) {
              signerProcesses[lambda_function].signerConfiguration.destination.s3.bucketName = signerProcesses[lambda_function].signerConfiguration.source.s3.bucketName
            }
        }
        // TODO: Remove this check with proper validation
        catch {
          throw new this.serverless.classes.Error("Incorrect signer plugin configuration");
        }

      }
    }

    else {
      const lambda_function = "common";
      signerProcesses[lambda_function] = {
        signerConfiguration: _.merge(defaultConfig, this.serverless.service.custom.signer),
        packageArtifact: this.serverless.service.package.artifact
      }
      
      try {
        // TODO: Remove this check with proper validation
        if (!signerProcesses[lambda_function].signerConfiguration.source.s3.bucketName) {
          throw new this.serverless.classes.Error("No bucket name was specified");
        }
        if (!signerProcesses[lambda_function].signerConfiguration.destination.s3.bucketName) {
            signerProcesses[lambda_function].signerConfiguration.destination.s3.bucketName = signerProcesses[lambda_function].signerConfiguration.source.s3.bucketName
          }
      }
      // TODO: Remove this check with proper validation
      catch {
        throw new this.serverless.classes.Error("Incorrect signer plugin configuration");
      }

    }
    return signerProcesses
  }

  signLambdas = async(serverless, options) => {

    this.serverless.cli.log('Signing functions...');

    const signerProcesses = this.generateSignerConfiguration();
    
    for (let lambda in signerProcesses) {
      var signItem = signerProcesses[lambda];
      // Copy deployment artifact to S3
      const fileContent = fs.readFileSync(signItem.packageArtifact);

      var S3Response = await this.serverless.providers.aws.request('S3', 'upload', {
        Bucket: signItem.signerConfiguration.source.s3.bucketName, 
        Key:  signItem.signerConfiguration.source.s3.key,
        Body: fileContent
      })

      // Update configuration with a version of the uploaded S3 object
      signItem.signerConfiguration.source.s3.version = S3Response.VersionId
      if (signItem.signerConfiguration.signingPolicy) {
        delete signItem.signerConfiguration.signingPolicy
      }

      // Start signing job
      var signJob = await this.serverless.providers.aws.request('Signer', 'startSigningJob', signItem.signerConfiguration)

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
        await fs.writeFile(signItem.packageArtifact, Body)
    }
  }

// TODO: Rewrite function definition
  addSigningConfigurationToCloudFormation = async(serverless, options) => {
    this.serverless.cli.log('Updating signing configuration...');
    var cloudFormationResources = this.serverless.service.provider.compiledCloudFormationTemplate.Resources;
    const signerProcesses = this.generateSignerConfiguration();
    for (let lambda in signerProcesses) {
      const profileName = signerProcesses[lambda].signerConfiguration.profileName;
      const signingPolicy = signerProcesses[lambda].signerConfiguration.signingPolicy;
      const resourceName = lambda+"CodeSigningConfig";
      // Copy deployment artifact to S3

      var profileArn = await signersMethods.getProfileParamByName(profileName, 'profileVersionArn', this.serverless)
      
      // TODO: Remove this check with proper validation
      if (!profileArn) {
        throw new Error("Signing profile not found")
      }

      const signingCFTemplate=cloudFormationGenerator.codeSigningConfig(profileArn, signingPolicy)

      cloudFormationResources[resourceName] = signingCFTemplate

      for (let resource in cloudFormationResources){
        if (cloudFormationResources[resource].Type === 'AWS::Lambda::Function') {
          cloudFormationResources[resource].Properties.CodeSigningConfigArn = {"Ref": resourceName}
        }
      }
    }
  }
}

module.exports = ServerlessPlugin;

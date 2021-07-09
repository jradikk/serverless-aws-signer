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
      'after:package:createDeploymentArtifacts': () => this.signLambdas().then(this.signLayers.bind(this)),
      'before:package:finalize': this.addSigningConfigurationToCloudFormation.bind(this),
      'signer:sign': this.signLambdas.bind(this),
      'before:remove:remove': this.removeResources.bind(this)
      // 'signer:updateCloudFormation': this.addSigningConfigurationToCloudFormation.bind(this)
    };

    const globalConfigSchemaProperties = {
      source: {
        type: 'object',
        properties: {
          s3: {
            type: 'object',
            properties: {
              bucketName: {type: "string"},
              key: {type: "string"}
            },
            required: ["bucketName"]
          }
        }
      },
      destination: {
        type: 'object',
        properties: {
          s3: {
            type: 'object',
            properties: {
              bucketName: {type: "string"},
              key: {type: "string"}
            }
          }
        }
      },
      profileName: {"type": "string"},
      signingPolicy: {"type": "string"}
    };

    const functionConfigSchemaProperties = {
      // Reserved for the future
    };

    serverless.configSchemaHandler.defineCustomProperties({
      type: 'object',
      properties: {
        signer: {
          '.*': {
            type: 'object',
            properties: globalConfigSchemaProperties,
            additionalProperties: false
          },
        },
      },
    });

    serverless.configSchemaHandler.defineFunctionProperties('aws', {
      properties: {
        signer: {
          '.*': {
            type: 'object',
            properties: globalConfigSchemaProperties,
            additionalProperties: false
          },
        },
      },
    });

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
      signingPolicy: "Enforce",
      retain: true
    }

    const lambda_functions = this.serverless.service.functions;

    if (this.serverless.service.package.individually === true) {  
      for (let lambda_function in lambda_functions) {
        // Since merge mutates the first object in a set, we need to pass an empty object. Otherwise, it'll rewrite the default configuration
        // https://stackoverflow.com/questions/19965844/lodash-difference-between-extend-assign-and-merge#comment57512843_19966511
        const mergedConfig = _.merge({}, defaultConfig, this.serverless.service.custom.signer, lambda_functions[lambda_function].signer);

        const packagePath = (lambda_functions[lambda_function].package) ? (lambda_functions[lambda_function].package.artifact) : (null)

        signerProcesses[lambda_function] = {
          signerConfiguration: mergedConfig,
          packageArtifact: packagePath
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

  generateLayersConfiguration() {
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
      signingPolicy: "Enforce",
      retain: true
    }

    const layers = this.serverless.service.layers;

    for (let layer in layers) {
      // Since merge mutates the first object in a set, we need to pass an empty object. Otherwise, it'll rewrite the default configuration
      // https://stackoverflow.com/questions/19965844/lodash-difference-between-extend-assign-and-merge#comment57512843_19966511
      const mergedConfig = _.merge({}, defaultConfig, this.serverless.service.custom.signer, layers[layer].signer);

      const packagePath = (layers[layer].package) ? (layers[layer].package.artifact) : (null)

      signerProcesses[layer] = {
        signerConfiguration: mergedConfig,
        packageArtifact: packagePath
      }
      try {
        // TODO: Remove this check with proper validation
        if (!signerProcesses[layer].signerConfiguration.source.s3.bucketName) {
          throw new this.serverless.classes.Error("No bucket name was specified");
        }
        if (!signerProcesses[layer].signerConfiguration.destination.s3.bucketName) {
            signerProcesses[layer].signerConfiguration.destination.s3.bucketName = signerProcesses[layer].signerConfiguration.source.s3.bucketName
          }
      }
      // TODO: Remove this check with proper validation
      catch {
        throw new this.serverless.classes.Error("Incorrect signer plugin configuration");
      }

    }

    return signerProcesses
  }


  async verifyConfiguration(configuration) {

    // Check if signingProfile is in place    
    const profileArn = await signersMethods.getProfileParamByName(configuration.signerConfiguration.profileName, 'profileVersionArn', this.serverless)
    
    if (!profileArn) {
      await this.createSigningProfile(configuration.signerConfiguration.profileName);
    }

    // Check if source bucket is in place
    try {
        await this.serverless.providers.aws.request("S3", "headBucket", {
        Bucket: configuration.signerConfiguration.source.s3.bucketName
      })
    }
    catch (e) {
      if (e.providerError.code === "NotFound") {
        await this.createS3Bucket(configuration.signerConfiguration.source.s3.bucketName)
      }
      else {
        throw (e)
      }
    }

    // Check if destination bucket is in place
    try {
      await this.serverless.providers.aws.request("S3", "headBucket", {
        Bucket: configuration.signerConfiguration.destination.s3.bucketName
      })
    }
    catch (e) {
      if (e.providerError.code === "NotFound") {
        await this.createS3Bucket(configuration.signerConfiguration.destination.s3.bucketName)
      }
      else {
        throw (e)
      }
    }

  }

  async signLambdas() {

    this.serverless.cli.log('Signing functions...');

    const signerProcesses = this.generateSignerConfiguration();
    
    for (let lambda in signerProcesses) {
      var signItem = signerProcesses[lambda];
      await this.verifyConfiguration(signItem);
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
        delete signItem.signerConfiguration.retain
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

  async signLayers() {
    this.serverless.cli.log('Signing layers...');

    const signerProcesses = this.generateLayersConfiguration();
    
    for (let layer in signerProcesses) {
      var signItem = signerProcesses[layer];
      await this.verifyConfiguration(signItem);
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
        delete signItem.signerConfiguration.retain
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

  async createS3Bucket(bucketName) {

    this.serverless.cli.log("Creating S3 bucket...")

    // https://github.com/aws/aws-sdk-js/issues/3647
    if (this.options.region == "us-east-1") {
      await this.serverless.providers.aws.request('S3', 'createBucket', {
        Bucket: bucketName
      })
    }

    else {
      var bucketConfiguration = {
        LocationConstraint: this.options.region
      }
      await this.serverless.providers.aws.request('S3', 'createBucket', {
        Bucket: bucketName,
        CreateBucketConfiguration: bucketConfiguration
      })
    }

    await this.serverless.providers.aws.request('S3', 'putBucketVersioning', {
      Bucket: bucketName,
      VersioningConfiguration: {
        MFADelete: "Disabled", 
        Status: "Enabled"
       }
    })

  }

  async createSigningProfile(profileName) {

    this.serverless.cli.log("Creating Signing profile...")
    // Get Lambda Platform ID for Signing profile
    const signingPlatforms = await this.serverless.providers.aws.request("Signer", "listSigningPlatforms", {
      partner: "AWSLambda"
    })

    // TODO: Add support for signing profile configuration
    const params = {
      platformId: signingPlatforms.platforms[0].platformId,
      profileName: profileName
    }

    await this.serverless.providers.aws.request('Signer', 'putSigningProfile', params)
    
    return
  }

  async addSigningConfigurationToCloudFormation() {
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

  async removeResources() {
    
    const signerProcesses = this.generateSignerConfiguration();

    for (let lambda in signerProcesses) {
      var signItem = signerProcesses[lambda];
      if (!signItem.signerConfiguration.retain) {
        await this.removeS3Bucket(signItem.signerConfiguration.source.s3.bucketName)
        await this.removeS3Bucket(signItem.signerConfiguration.destination.s3.bucketName)
      }
    }

    for (let lambda in signerProcesses) {
      var signItem = signerProcesses[lambda];
      if (!signItem.signerConfiguration.retain) {
        await this.removeSigningProfile(signItem.signerConfiguration.profileName)
      }
    }
  }
  
  async removeSigningProfile(profileName) {

    // Make sure signing profile exists and hasn't been revoked yet
    try {

    const profileVersion = await signersMethods.getProfileParamByName(profileName, 'profileVersion', this.serverless)

    if (profileName && profileVersion) {
      const params = {
        effectiveTime: new Date,
        profileName: profileName,
        profileVersion: profileVersion,
        reason: 'Project removal'
      };

      await this.serverless.providers.aws.request('Signer', 'revokeSigningProfile', params)
      }
    }
    catch (e) {
      if (e.providerError.code !== "ProfileRevoked") {
        throw (e)
      }
    }
    return
  }

  async removeS3Bucket(bucketName) {

    // Make sure bucket exists
    try {
      await this.serverless.providers.aws.request("S3", "headBucket", {
        Bucket: bucketName
      })
      // Cleanup S3 bucket
      var s3ObjectsList = [];

      // TODO: Use ContinuationToken to go through an array of more than 1000 versions/keys
      while (s3ObjectsList) {
        s3ObjectsList = [];
        var s3Objects = await this.serverless.providers.aws.request('S3', 'listObjectVersions', {
          Bucket: bucketName
        })

        s3Objects.Versions.forEach(item => {s3ObjectsList.push({"Key": item.Key, VersionId: item.VersionId})})
        s3Objects.DeleteMarkers.forEach(item => {s3ObjectsList.push({"Key": item.Key, VersionId: item.VersionId})})
        
        if (s3ObjectsList.length > 0) {
          var response = await this.serverless.providers.aws.request('S3', 'deleteObjects', {
            Bucket: bucketName,
            Delete: {
              Objects: s3ObjectsList
            }
          })
        }
        else {
          s3ObjectsList = null
        }
      }

      // Delete S3 bucket
      await this.serverless.providers.aws.request('S3', 'deleteBucket', {
        Bucket: bucketName
      })

    }
    catch (e) {
      if (e.providerError.code !== "NotFound") {
        throw (e)
      }
    }

    // // Disable versioning
    // await this.serverless.providers.aws.request('S3', 'putBucketVersioning', {
    //   Bucket: bucketName,
    //   VersioningConfiguration: {
    //     MFADelete: "Disabled", 
    //     Status: "Enabled"
    //    }
    // })

  }

}

module.exports = ServerlessPlugin;

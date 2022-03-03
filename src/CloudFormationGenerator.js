exports.codeSigningConfig = (profileArn, signingPolicy, description) => {
    
  template = {
    "Type": "AWS::Lambda::CodeSigningConfig",
    "Properties": {
      "AllowedPublishers": {
        "SigningProfileVersionArns": [profileArn]
      },
      "CodeSigningPolicies": {
        "UntrustedArtifactOnDeployment": signingPolicy
      },
      "Description": description
    }
  };

  return template;

}
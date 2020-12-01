exports.codeSigningConfig = (profileArn, signingPolicy) => {
    
    template={
        "Type" : "AWS::Lambda::CodeSigningConfig",
        "Properties" : {
            "AllowedPublishers" : {
              "SigningProfileVersionArns" : [ profileArn ]
            },
            "CodeSigningPolicies" : {
              "UntrustedArtifactOnDeployment" : signingPolicy
            },
            "Description" : "blabla"
          }
      }

      return template

}
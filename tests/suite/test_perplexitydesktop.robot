*** Settings ***
Documentation    Test cases for perplexity-desktop snap
Resource         kvm.resource


*** Test Cases ***
Perplexity Desktop Launches And Renders
    [Documentation]    Verify perplexity-desktop snap launches and renders a UI on Mir
    [Tags]    smoke    yarf:certification_status: blocker
    Log Screenshot
